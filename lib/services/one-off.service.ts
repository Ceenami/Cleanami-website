import "server-only";
import { insertIssuedJobs } from "@/lib/services/job-execution-contract";

import { randomUUID } from "crypto";
import { db } from "@/db";
import { customers, jobs, properties } from "@/db/schemas";
import { PricingService } from "@/lib/services/pricing.service";
import { rentalQuoteRefusal } from "@/lib/pricing/rental-quote-refusal";
import { buildJobStaffingUpdate } from "@/lib/pricing/apply-job-staffing";
import { loadHotTubTimeAdditions } from "@/lib/pricing/hot-tub-time";
import { getStripe } from "@/lib/stripe/get-stripe";
import { voidCharge } from "@/lib/services/payment/void-charge";
import {
  CUSTOM_QUOTE_EXISTING_PROPERTY_MESSAGE,
  LAUNDRY_LOADS_INCOMPLETE_MESSAGE,
} from "@/lib/pricing/custom-quote-message";
import { getStartOfTodayEastern } from "@/lib/time/eastern";
import {
  getArrivalInstant,
  getDeadlineInstant,
  meetsResidentialNotice,
  RESIDENTIAL_NOTICE_MESSAGE,
} from "@/lib/scheduling/residential-notice";
import {
  recordPromoRedemption,
  resolvePromoCodeForAmount,
} from "@/lib/services/promo-code.service";
import { fromZonedTime } from "date-fns-tz";
import { addDays } from "date-fns";
import { and, eq, ne } from "drizzle-orm";
import { issuePropertyChecklist } from "@/lib/services/property-checklists";
import {
  buildResidentialJobStaffing,
  type ResidentialCleaningLevel,
  type ResidentialTerms,
  residentialOperationalHours,
  toPublicResidentialQuote,
} from "@/lib/pricing/residential";
import {
  evaluateResidentialSale,
  evaluateResidentialCheckout,
} from "@/lib/pricing/residential-sales";
import {
  getArrivalWindow,
  windowFitsOperatingDay,
} from "@/lib/scheduling/arrival-windows";
import { RESIDENTIAL_NO_WINDOW_MESSAGE } from "@/lib/scheduling/residential-notice";
import { getJobDisplay } from "@/lib/constants/service-type";
import { residentialPaymentIdentity } from "@/lib/pricing/residential-payment-identity";
import {
  prepareResidentialCheckout,
  residentialCheckoutSlot,
  getOrCreateResidentialCheckoutPayment,
  markResidentialCheckoutIssued,
  ResidentialCheckoutReviewRequired,
  loadReusableResidentialCheckout,
} from "./residential-checkout.service";

const EASTERN_TZ = "America/New_York";
/** Sensible default lead time for a one-off so it can be staffed/assigned. */
const ONE_OFF_BUFFER_DAYS = 2;

export type BookOneOffInput = {
  propertyId: string;
  date: string;
  /** Optional customer-entered promo code; discounts this one clean only. */
  promoCode?: string;
  /** Residential arrival window. */
  arrivalWindow?: string;
  cleaningLevel?: ResidentialCleaningLevel;
  quoteIdentity?: string;
  pricingVersion?: "residential-v1" | "residential-v2";
  hotTub?: "none" | "basic" | "full";
  inUnitLaundryLoads?: number;
};
export type BookOneOffResult =
  | {
      success: true;
      jobId: string;
      amountCents: number;
      promoCode?: string;
      promoDiscountCents?: number;
    }
  | {
      success: false;
      error: string;
      /** True for an infrastructure failure. */
      unexpected?: true;
      /** Explicit override when the default 400/500 split is wrong. */
      status?: number;
    };

type PricedProperty = NonNullable<
  Awaited<ReturnType<typeof db.query.properties.findFirst>>
>;

/** Price a single clean with the shared pricing engine. */
async function priceOneOffCents(
  property: PricedProperty,
  cleaningLevel?: ResidentialCleaningLevel,
  scope?: Pick<
    BookOneOffInput,
    "pricingVersion" | "hotTub" | "inUnitLaundryLoads"
  >,
  acceptedCheckout?: Awaited<
    ReturnType<typeof loadReusableResidentialCheckout>
  >,
): Promise<
  | { ok: true; amountCents: number; residentialTerms?: ResidentialTerms }
  | { ok: false; error: string }
> {
  if (property.serviceType === "residential_one_time") {
    if (!acceptedCheckout && property.priceOverrideCents != null) {
      return {
        ok: false,
        error:
          "This property has an agreed custom price. Please contact CleanNami to schedule it.",
      };
    }
    if (
      acceptedCheckout &&
      (cleaningLevel !== acceptedCheckout.terms.input.cleaningLevel ||
        (scope?.hotTub ?? "none") !== acceptedCheckout.terms.input.hotTub ||
        (scope?.inUnitLaundryLoads ?? 0) !==
          acceptedCheckout.terms.input.inUnitLaundryLoads ||
        (scope?.pricingVersion &&
          scope.pricingVersion !== acceptedCheckout.terms.ruleVersion))
    )
      return {
        ok: false,
        error:
          "Payment has already started for a different scope. Review the existing booking or contact CleanNami.",
      };
    const evaluation = acceptedCheckout
      ? evaluateResidentialCheckout(
          acceptedCheckout.terms.input,
          acceptedCheckout.terms.ruleVersion,
          acceptedCheckout.terms.configHash,
          acceptedCheckout.terms.executionPolicy,
        )
      : evaluateResidentialSale({
          bedrooms: property.bedCount,
          bathrooms: Number(property.bathCount),
          sqft: property.sqFt,
          petsAllowed: property.petsAllowed,
          cleaningLevel,
          pricingVersion: scope?.pricingVersion,
          hotTub: scope?.hotTub ?? "none",
          inUnitLaundryLoads: scope?.inUnitLaundryLoads ?? 0,
        });
    return evaluation.ok
      ? {
          ok: true,
          amountCents: evaluation.terms.amountCents,
          residentialTerms: evaluation.terms,
        }
      : { ok: false, error: evaluation.error };
  }
  const pricing = new PricingService();
  const priceDetails = await pricing.calculatePrice({
    bedrooms: property.bedCount,
    bathrooms: Number(property.bathCount),
    sqft: property.sqFt ?? 0,
    laundryService: property.laundryType,
    laundryLoads: property.laundryLoads,
    hasHotTub: property.hasHotTub,
    hotTubService: property.hotTubServiceLevel,
    hotTubDrain: property.hotTubDrain,
    hotTubDrainCadence: property.hotTubDrainCadence,
    // Include pet pricing for one-off bookings.
    petsAllowed: property.petsAllowed,
    subscriptionMonths: 1,
    priceOverrideCents: property.priceOverrideCents,
  } as any);

  if (priceDetails.pricingUnavailable || priceDetails.isCustomQuote) {
    return { ok: false, error: CUSTOM_QUOTE_EXISTING_PROPERTY_MESSAGE };
  }

  // Refuse laundry bookings without a load count.
  if (priceDetails.laundryLoadsMissing) {
    return { ok: false, error: LAUNDRY_LOADS_INCOMPLETE_MESSAGE };
  }

  const refusal = rentalQuoteRefusal(priceDetails, {
    bedrooms: property.bedCount,
    bathrooms: Number(property.bathCount),
    sqft: property.sqFt ?? 0,
  });
  if (refusal) return { ok: false, error: refusal };

  const amountCents = Math.round(priceDetails.totalPerClean * 100);
  if (amountCents < 50) {
    return { ok: false, error: "Calculated price is too low to charge." };
  }

  return { ok: true, amountCents };
}

async function loadOwnedProperty(customerId: string, propertyId: string) {
  return db.query.properties.findFirst({
    where: and(
      eq(properties.id, propertyId),
      eq(properties.customerId, customerId),
    ),
    with: { checklistFiles: true },
  });
}

/** Dynamic selected-scope preview; owner-scoped, explicit public allowlist. */
export async function quoteResidentialOneOff(
  customerId: string,
  input: BookOneOffInput,
) {
  const property = await loadOwnedProperty(customerId, input.propertyId);
  if (!property || property.serviceType !== "residential_one_time")
    return { refused: true, message: "Property not found." };
  const priced = await priceOneOffCents(property, input.cleaningLevel, input);
  return priced.ok && priced.residentialTerms
    ? toPublicResidentialQuote(priced.residentialTerms)
    : {
        refused: true,
        message: priced.ok ? "Quote unavailable." : priced.error,
      };
}

export type OneOffPromoPreview =
  | {
      valid: true;
      code: string;
      amountCents: number;
      discountCents: number;
      finalAmountCents: number;
      capped: boolean;
    }
  | { valid: false; message: string };

/** Preview one-off promo pricing. */
export async function previewOneOffPromoCode(
  customerId: string,
  propertyId: string,
  rawCode: string,
  cleaningLevel?: ResidentialCleaningLevel,
  scope?: Pick<
    BookOneOffInput,
    "pricingVersion" | "hotTub" | "inUnitLaundryLoads"
  >,
): Promise<OneOffPromoPreview> {
  const property = await loadOwnedProperty(customerId, propertyId);
  if (!property) return { valid: false, message: "Property not found." };

  const priced = await priceOneOffCents(property, cleaningLevel, scope);
  if (!priced.ok) return { valid: false, message: priced.error };
  if (priced.residentialTerms?.ruleVersion === "residential-v2")
    return {
      valid: false,
      message:
        "Promotions are unavailable for this residential pricing version.",
    };

  const customer = await db.query.customers.findFirst({
    where: eq(customers.id, customerId),
    columns: { email: true },
  });

  const { evaluation } = await resolvePromoCodeForAmount(
    rawCode,
    priced.amountCents,
    customer?.email ?? "",
  );

  if (!evaluation.valid) return { valid: false, message: evaluation.message };

  return {
    valid: true,
    code: evaluation.code,
    amountCents: priced.amountCents,
    discountCents: evaluation.discountCents,
    finalAmountCents: evaluation.finalAmountCents,
    capped: evaluation.capped,
  };
}

/** Book a prepaid one-off clean for an existing property. */
export async function bookOneOffClean(
  customerId: string,
  input: BookOneOffInput,
): Promise<BookOneOffResult> {
  const property = await loadOwnedProperty(customerId, input.propertyId);
  if (!property) return { success: false, error: "Property not found." };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    return { success: false, error: "Please choose a valid date." };
  }

  // Residential uses its selected arrival window; rentals use guest turnover times.
  const isResidential = property.serviceType === "residential_one_time";
  const arrivalWindow = input.arrivalWindow?.trim() || null;

  let arrival: Date;
  let rentalDeadline: Date | null = null;

  if (isResidential) {
    const instant = getArrivalInstant(input.date, arrivalWindow);
    if (!instant) {
      return {
        success: false,
        error: "Please choose an arrival window for this clean.",
      };
    }
    arrival = instant;

    if (!meetsResidentialNotice(input.date, arrivalWindow)) {
      return { success: false, error: RESIDENTIAL_NOTICE_MESSAGE };
    }
  } else {
    const checkOutTime = property.defaultCheckOutTime ?? "09:00:00";
    const checkInTime = property.defaultCheckInTime ?? "16:00:00";
    arrival = fromZonedTime(`${input.date}T${checkOutTime}`, EASTERN_TZ);
    rentalDeadline = fromZonedTime(`${input.date}T${checkInTime}`, EASTERN_TZ);

    if (
      Number.isNaN(arrival.getTime()) ||
      Number.isNaN(rentalDeadline.getTime())
    ) {
      console.error(
        `[bookOneOffClean] property ${property.id} has unusable check-in/check-out times:`,
        { checkInTime, checkOutTime },
      );
      return {
        success: false,
        error:
          "This property's check-in/check-out times are misconfigured, so we cannot schedule a clean. Please contact CleanNami.",
      };
    }

    const earliest = addDays(getStartOfTodayEastern(), ONE_OFF_BUFFER_DAYS);
    if (arrival < earliest) {
      return {
        success: false,
        error: `Please choose a date at least ${ONE_OFF_BUFFER_DAYS} days out.`,
      };
    }
  }

  // Accepted attempts survive rollback and mutable property geometry. New sales
  // still pass through the real active-policy gate.
  const acceptedCheckout = isResidential
    ? await loadReusableResidentialCheckout(
        residentialCheckoutSlot("portal", [
          customerId,
          property.id,
          input.date,
        ]),
      )
    : null;
  const priced = await priceOneOffCents(
    property,
    input.cleaningLevel,
    input,
    acceptedCheckout,
  );
  if (!priced.ok) return { success: false, error: priced.error };
  const amountCents = priced.amountCents;
  if (priced.residentialTerms) {
    if (input.quoteIdentity !== priced.residentialTerms.inputIdentity) {
      return {
        success: false,
        error:
          "This property's quote changed. Refresh the page and review the price before booking.",
      };
    }
    const window = getArrivalWindow(arrivalWindow);
    if (
      !window ||
      !windowFitsOperatingDay(
        window,
        residentialOperationalHours(priced.residentialTerms),
      )
    ) {
      return { success: false, error: RESIDENTIAL_NO_WINDOW_MESSAGE };
    }
  }

  const customer = await db.query.customers.findFirst({
    where: eq(customers.id, customerId),
    columns: { stripeCustomerId: true, email: true, skipPayment: true },
  });

  // Comped accounts can book without a card.
  const skipPayment = customer?.skipPayment === true;
  if (
    acceptedCheckout &&
    acceptedCheckout.amountChargedCents !== (skipPayment ? 0 : amountCents)
  )
    return {
      success: false,
      status: 409,
      error:
        "Billing terms changed after payment started. Contact CleanNami before retrying.",
    };

  const stripe = getStripe();
  let paymentMethodId: string | undefined;

  if (!skipPayment) {
    if (!stripe || !customer?.stripeCustomerId) {
      return {
        success: false,
        error: "Payment is not set up for your account.",
      };
    }

    // Handle invalid Stripe customer records as a booking failure.
    let paymentMethods;
    if (!acceptedCheckout?.paymentIntentId) {
      try {
        paymentMethods = await stripe.paymentMethods.list({
          customer: customer.stripeCustomerId,
          type: "card",
        });
      } catch (err) {
        console.error("[bookOneOffClean] payment method lookup failed", err);
        return {
          success: false,
          unexpected: true,
          status: 503,
          error:
            "We could not reach our payment provider. Nothing has been charged — please try again in a moment.",
        };
      }

      paymentMethodId = paymentMethods.data[0]?.id;
      if (!paymentMethodId) {
        return {
          success: false,
          error: "No saved card on file. Please contact support.",
        };
      }
    }
  }

  // Resolve promotional pricing before payment.
  const submittedPromoCode = input.promoCode?.trim() ?? "";
  if (
    submittedPromoCode &&
    priced.residentialTerms?.ruleVersion === "residential-v2"
  )
    return {
      success: false,
      error: "Promotions are unavailable for this residential pricing version.",
    };
  let chargeAmountCents = amountCents;
  let appliedPromo: {
    promoCodeId: string;
    code: string;
    discountCents: number;
  } | null = null;

  if (submittedPromoCode) {
    let resolved;
    try {
      resolved = await resolvePromoCodeForAmount(
        submittedPromoCode,
        amountCents,
        customer.email ?? "",
      );
    } catch (err) {
      console.error("[bookOneOffClean] promo code lookup failed", err);
      return {
        success: false,
        unexpected: true,
        error:
          "We could not check that promo code. Nothing has been charged — please try again.",
      };
    }
    const { evaluation, promoCodeId } = resolved;

    if (!evaluation.valid || !promoCodeId) {
      return {
        success: false,
        error: evaluation.valid
          ? "That promo code is not valid."
          : `${evaluation.message} Remove or correct the code to continue.`,
      };
    }

    chargeAmountCents = evaluation.finalAmountCents;
    appliedPromo = {
      promoCodeId,
      code: evaluation.code,
      discountCents: evaluation.discountCents,
    };
  }

  // Calculate staffing before taking payment.
  let staffing;
  try {
    const hotTubTimeAdditions = priced.residentialTerms
      ? null
      : await loadHotTubTimeAdditions();
    staffing = priced.residentialTerms
      ? buildResidentialJobStaffing(
          priced.residentialTerms,
          skipPayment ? 0 : chargeAmountCents,
          appliedPromo?.discountCents ?? 0,
          skipPayment ? chargeAmountCents : 0,
        )
      : buildJobStaffingUpdate({
          property: {
            bedCount: property.bedCount,
            bathCount: property.bathCount,
            sqFt: property.sqFt,
            laundryType: property.laundryType,
            hotTubServiceLevel: property.hotTubServiceLevel,
            hotTubDrainCadence: property.hotTubDrainCadence,
            petsAllowed: property.petsAllowed,
          },
          checkInTime: arrival,
          subscriptionStart: arrival,
          hotTubTimeAdditions,
        });
  } catch (err) {
    console.error("[bookOneOffClean] staffing calculation failed", err);
    return {
      success: false,
      unexpected: true,
      error:
        "We could not schedule this clean. Nothing has been charged — please try again or contact CleanNami.",
    };
  }

  // Residential deadlines include the expected cleaning time.
  const deadline = isResidential
    ? getDeadlineInstant(
        input.date,
        arrivalWindow,
        priced.residentialTerms
          ? residentialOperationalHours(priced.residentialTerms)
          : staffing.staffing.expectedHoursPerCleaner,
      )
    : rentalDeadline;

  if (!deadline) {
    console.error(
      "[bookOneOffClean] unusable arrival window or expected hours",
      {
        date: input.date,
        arrivalWindow,
        expectedHours: staffing.staffing.expectedHoursPerCleaner,
      },
    );
    return {
      success: false,
      error: "We could not schedule that date and time. Please choose another.",
    };
  }

  // Return an existing booking on a retry.
  const existingBooking = await db.query.jobs.findFirst({
    where: and(
      eq(jobs.propertyId, property.id),
      eq(jobs.checkInTime, arrival),
      eq(jobs.jobSource, "customer_one_off"),
      ne(jobs.status, "canceled"),
    ),
    columns: { id: true, addonsSnapshot: true },
  });
  if (existingBooking) {
    if (
      priced.residentialTerms &&
      existingBooking.addonsSnapshot?.residentialPricing?.inputIdentity !==
        priced.residentialTerms.inputIdentity
    ) {
      return {
        success: false,
        status: 409,
        error:
          "A clean is already booked for this arrival. Open your upcoming clean to review its issued terms.",
      };
    }
    return {
      success: true,
      jobId: existingBooking.id,
      amountCents:
        existingBooking.addonsSnapshot?.residentialPricing
          ?.amountChargedCents ?? amountCents,
    };
  }

  let paymentIntentId: string | null = null;
  let checkoutAttempt: Awaited<
    ReturnType<typeof prepareResidentialCheckout>
  > | null = null;
  if (priced.residentialTerms?.ruleVersion === "residential-v2") {
    try {
      const requestIdentity = residentialPaymentIdentity({
        inputIdentity: priced.residentialTerms.inputIdentity,
        email: customer?.email ?? "",
        address: property.address,
        cleanDate: input.date,
        arrivalWindow: arrivalWindow ?? "",
        amountCents: skipPayment ? 0 : chargeAmountCents,
        promoCode: null,
        promoDiscountCents: 0,
      });
      checkoutAttempt = await prepareResidentialCheckout({
        slotKey: residentialCheckoutSlot("portal", [
          customerId,
          property.id,
          input.date,
        ]),
        requestIdentity,
        terms: priced.residentialTerms,
        amountChargedCents: skipPayment ? 0 : chargeAmountCents,
      });
    } catch (error) {
      return {
        success: false,
        status: error instanceof ResidentialCheckoutReviewRequired ? 409 : 503,
        error:
          error instanceof ResidentialCheckoutReviewRequired
            ? error.message
            : "Could not prepare your booking. No new payment was started.",
      };
    }
  }
  if (skipPayment) {
    chargeAmountCents = 0;
  } else {
    try {
      const create = (idempotencyKey: string) =>
        stripe!.paymentIntents.create(
          {
            amount: chargeAmountCents,
            currency: "usd",
            customer: customer.stripeCustomerId!,
            payment_method: paymentMethodId!,
            off_session: true,
            confirm: true,
            metadata: {
              ...(checkoutAttempt
                ? {
                    residential_checkout_attempt: checkoutAttempt.id,
                    request_identity: checkoutAttempt.requestIdentity,
                  }
                : {}),
              type: "one_off",
              propertyId: property.id,
              customerId,
              ...(priced.residentialTerms
                ? {
                    cleaning_level: priced.residentialTerms.input.cleaningLevel,
                    residential_rule_version:
                      priced.residentialTerms.ruleVersion,
                    ...(priced.residentialTerms.ruleVersion === "residential-v2"
                      ? {
                          residential_config_hash:
                            priced.residentialTerms.configHash,
                          residential_scope: JSON.stringify(
                            priced.residentialTerms.input,
                          ),
                        }
                      : {}),
                    residential_input_identity:
                      priced.residentialTerms.inputIdentity,
                    arrival_window: arrivalWindow ?? "",
                    service_label: getJobDisplay({
                      serviceType: property.serviceType,
                      cleaningLevel: input.cleaningLevel,
                    }).label,
                  }
                : {}),
              promo_code: appliedPromo?.code ?? "",
              promo_discount_cents: String(appliedPromo?.discountCents ?? 0),
            },
          },
          // Retries for the same customer, property, and date share a charge.
          { idempotencyKey },
        );
      const paymentIntent = checkoutAttempt
        ? await getOrCreateResidentialCheckoutPayment(
            checkoutAttempt,
            stripe!,
            create,
          )
        : await create(`oneoff_${customerId}_${property.id}_${input.date}`);
      if (paymentIntent.status !== "succeeded") {
        return { success: false, error: "Payment could not be completed." };
      }
      paymentIntentId = paymentIntent.id;
    } catch (err) {
      console.error("[bookOneOffClean] charge failed", err);
      // Stripe rejects retries with changed idempotency parameters.
      const stripeError = err as {
        rawType?: string;
        type?: string;
        message?: string;
      } | null;
      if (
        stripeError?.rawType === "idempotency_error" ||
        stripeError?.type === "StripeIdempotencyError"
      ) {
        return {
          success: false,
          error:
            "You have already booked a clean for this property on this date. Refresh to see it.",
        };
      }

      // Only card-decline copy is safe to return directly from Stripe.
      if (stripeError?.type === "StripeCardError" && stripeError.message) {
        return { success: false, error: stripeError.message };
      }
      return {
        success: false,
        unexpected: true,
        error:
          "We could not confirm the payment outcome. Contact CleanNami before retrying or making another payment.",
      };
    }
  }

  // Do not reuse an intent that has already entered the refund flow.
  if (paymentIntentId) {
    try {
      const refunds = await stripe!.refunds.list({
        payment_intent: paymentIntentId,
        limit: 1,
      });
      if (refunds.data.some((refund) => refund.status !== "failed")) {
        return {
          success: false,
          error:
            "Your earlier payment is being refunded, so this clean was not booked. Please try again after the refund is confirmed, or contact CleanNami.",
        };
      }
    } catch (err) {
      console.error("[bookOneOffClean] refund-state lookup failed", err);
      return {
        success: false,
        unexpected: true,
        error:
          "We could not verify the earlier payment. Nothing new has been booked — please try again shortly or contact CleanNami.",
      };
    }
  }

  // Check once more in case a concurrent retry saved the job.
  const savedBooking = await db.query.jobs.findFirst({
    where: and(
      eq(jobs.propertyId, property.id),
      eq(jobs.checkInTime, arrival),
      eq(jobs.jobSource, "customer_one_off"),
      ne(jobs.status, "canceled"),
    ),
    columns: { id: true, addonsSnapshot: true },
  });
  if (savedBooking) {
    if (
      priced.residentialTerms &&
      savedBooking.addonsSnapshot?.residentialPricing?.inputIdentity !==
        priced.residentialTerms.inputIdentity
    ) {
      return {
        success: false,
        status: 409,
        error:
          "A clean was booked concurrently for this arrival. Open your upcoming clean before trying again.",
      };
    }
    return {
      success: true,
      jobId: savedBooking.id,
      amountCents:
        savedBooking.addonsSnapshot?.residentialPricing?.amountChargedCents ??
        chargeAmountCents,
      promoCode: appliedPromo?.code,
      promoDiscountCents: appliedPromo?.discountCents,
    };
  }

  // Refund the charge if the job cannot be saved.
  let job: { id: string } | undefined;
  try {
    [job] = await insertIssuedJobs(db, [{
        subscriptionId: null,
        propertyId: property.id,
        checkInTime: arrival,
        checkOutTime: deadline,
        calendarEventUid: `oneoff_${randomUUID()}`,
        status: "unassigned",
        // Preserve the property service type and record the creation path.
        serviceType: property.serviceType,
        jobSource: "customer_one_off",
        expectedHours: staffing.expectedHours,
        addonsSnapshot: isResidential
          ? { ...staffing.addonsSnapshot, arrivalWindow }
          : staffing.addonsSnapshot,
        checklistSnapshot: await issuePropertyChecklist(
          {
            ...property,
            cleaningLevel: input.cleaningLevel,
            residentialPricing:
              "residentialPricing" in staffing.addonsSnapshot
                ? staffing.addonsSnapshot.residentialPricing
                : undefined,
          },
          property.checklistFiles,
        ),
        // Link the captured payment for reserves and possible refunds.
        paymentIntentId,
        residentialCheckoutAttemptId: checkoutAttempt?.id ?? null,
        paymentStatus: skipPayment ? null : "captured",
        promoCodeId: appliedPromo?.promoCodeId ?? null,
        notes: skipPayment
          ? `[System] One-off clean booked with payment skipped (comped account). No charge taken.`
          : `[System] One-off clean prepaid. PaymentIntent ${paymentIntentId}.`,
      }], isResidential ? undefined : property);

    if (!job) throw new Error("jobs insert returned no rows");
  } catch (err) {
    // Another completion may have won the real-PaymentIntent unique index.
    // Do not refund a charge already linked to that successful job.
    if (paymentIntentId || checkoutAttempt) {
      try {
        const replayed = await db.query.jobs.findFirst({
          where: checkoutAttempt
            ? eq(jobs.residentialCheckoutAttemptId, checkoutAttempt.id)
            : eq(jobs.paymentIntentId, paymentIntentId!),
          columns: { id: true, status: true, paymentStatus: true, addonsSnapshot: true },
        });
        if (replayed?.status === "canceled" || replayed?.paymentStatus === "refunded")
          return { success: false, error: "This payment belongs to a canceled or refunded booking. Contact CleanNami before booking again." };
        if (replayed)
          return {
            success: true,
            jobId: replayed.id,
            amountCents:
              replayed.addonsSnapshot?.residentialPricing?.amountChargedCents ??
              chargeAmountCents,
            promoCode: appliedPromo?.code,
            promoDiscountCents: appliedPromo?.discountCents,
          };
      } catch (lookupError) {
        console.error(
          "[bookOneOffClean] concurrent completion lookup failed",
          lookupError,
        );
        return {
          success: false,
          unexpected: true,
          error:
            "We could not verify your booking. Contact CleanNami before trying another payment.",
        };
      }
    }
    console.error(
      "[bookOneOffClean] job insert failed AFTER charge — refunding",
      err,
    );
    try {
      await voidCharge({
        paymentIntentId,
        paymentStatus: "captured",
        context: "one-off booking",
        strict: true,
      });
    } catch {
      return {
        success: false,
        unexpected: true,
        error:
          "We could not save the booking or confirm the refund. Contact CleanNami before making another payment.",
      };
    }
    return {
      success: false,
      unexpected: true,
      error:
        "We took payment but could not save your booking, so the charge has been refunded. Please try again, or contact CleanNami if you do not see the refund.",
    };
  }

  // Promo bookkeeping must not undo a completed booking.
  if (checkoutAttempt) {
    // The unique job FK is authoritative if this bookkeeping write needs retry.
    try {
      await markResidentialCheckoutIssued(checkoutAttempt.id, job.id);
    } catch {
      console.error(
        "[bookOneOffClean] checkout issue marker needs reconciliation",
      );
    }
  }
  if (appliedPromo) {
    try {
      await recordPromoRedemption({
        promoCodeId: appliedPromo.promoCodeId,
        code: appliedPromo.code,
        customerEmail: customer.email ?? "",
        customerId,
        subscriptionId: null,
        jobId: job.id,
        // Use the job ID when payment was intentionally skipped.
        paymentIntentId: paymentIntentId ?? `skip_payment_${job.id}`,
        originalAmountCents: amountCents,
        discountAmountCents: appliedPromo.discountCents,
        finalAmountCents: chargeAmountCents,
      });
    } catch (err) {
      console.error(
        `[bookOneOffClean] promo redemption bookkeeping failed for job ${job.id}`,
        err,
      );
    }
  }

  return {
    success: true,
    jobId: job.id,
    amountCents: chargeAmountCents,
    promoCode: appliedPromo?.code,
    promoDiscountCents: appliedPromo?.discountCents,
  };
}
