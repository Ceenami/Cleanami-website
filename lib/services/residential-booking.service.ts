import "server-only";

import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import {
  recordPromoRedemption,
  resolvePromoCodeForAmount,
} from "@/lib/services/promo-code.service";
import Stripe from "stripe";

import { getDbOrNull } from "@/db";
import { customers, jobs, properties } from "@/db/schemas";
import { isUniqueViolation } from "@/lib/db/errors";
import { getStripe } from "@/lib/stripe/get-stripe";
import { SERVICE_UNAVAILABLE } from "@/lib/env/messages";
import { geocodeAddressResult } from "@/lib/services/google-maps/geocoding";
import { isPointInServiceArea } from "@/lib/google-maps/serviceArea/index.ts";
import { PricingService } from "@/lib/services/pricing.service";
import { buildJobStaffingUpdate } from "@/lib/pricing/apply-job-staffing";
import { loadHotTubTimeAdditions } from "@/lib/pricing/hot-tub-time";
import { voidCharge } from "@/lib/services/payment/void-charge";
import { sendResidentialBookingConfirmationEmail } from "@/lib/services/email.service";
import { notifyAdmins } from "@/lib/queries/admin-notifications";
import {
  buildResidentialPricingInput,
  residentialQuoteRefusal,
} from "@/lib/pricing/residential-pricing-input";
import { calculateJobStaffing } from "@/lib/pricing/staffing-logic";
import { inviteCustomerToPortalAfterPayment } from "@/lib/services/auth/customer-account.service";
import {
  residentialFormSchema,
  type ResidentialFormData,
} from "@/lib/validations/residential";
import { normalizeResidentialFormData } from "@/lib/validations/residential/serialize";
import {
  getArrivalWindow,
  minutesToTimeOfDay,
  mustFinishBeforeMinutes,
  windowFitsOperatingDay,
  type ArrivalWindow,
} from "@/lib/scheduling/arrival-windows";
import {
  earliestBookableDate,
  getArrivalInstant,
  getDeadlineInstant,
  meetsResidentialNotice,
  RESIDENTIAL_NOTICE_MESSAGE,
  RESIDENTIAL_NO_WINDOW_MESSAGE,
} from "@/lib/scheduling/residential-notice";
import type { PriceDetails } from "@/lib/validations/bookng-modal";

/** Residential one-time booking and payment flow. */

const pricingService = new PricingService();

export type ResidentialRefusalReason =
  | "validation"
  | "notice"
  | "no_window"
  | "custom_quote"
  | "pricing_unavailable"
  | "out_of_area"
  | "unavailable";

export type ResidentialQuote = {
  ok: true;
  form: ResidentialFormData;
  priceDetails: PriceDetails;
  window: ArrivalWindow;
  /** Per-cleaner expected hours; the wall-clock length of the clean. */
  expectedHours: number;
  /** Window start. Becomes jobs.check_in_time. */
  arrival: Date;
  /** Must finish before: window end + expected hours. Becomes jobs.check_out_time. */
  deadline: Date;
  amountCents: number;
};

export type ResidentialRefusal = {
  ok: false;
  reason: ResidentialRefusalReason;
  error: string;
  /** If we turn someone away, tell them the first date they could book. */
  earliestBookableDate?: string;
  /** Field-level errors, so the wizard can point at the control that is wrong. */
  fieldErrors?: Record<string, string[] | undefined>;
};

/** Validate and price a booking without creating a payment or writing data. */
export async function evaluateResidentialBooking(
  input: ResidentialFormData,
  now: Date = new Date()
): Promise<ResidentialQuote | ResidentialRefusal> {
  const form = normalizeResidentialFormData(input);

  // Check booking rules before schema validation so the UI gets a useful refusal.
  const hasSizing =
    Number.isFinite(form.bedrooms) &&
    (form.bedrooms ?? 0) > 0 &&
    Number.isFinite(form.bathrooms) &&
    (form.bathrooms ?? 0) > 0;
  const preWindow = getArrivalWindow(form.arrivalWindow);

  if (hasSizing && preWindow && form.cleanDate) {
    const preHours = calculateJobStaffing({
      bedCount: form.bedrooms!,
      bathCount: form.bathrooms!,
      sqFt: form.sqft ?? null,
      laundryType: "none",
      hotTubServiceLevel: false,
      hotTubDeepClean: false,
    }).expectedHoursPerCleaner;

    // Enforce window availability on the server.
    if (!windowFitsOperatingDay(preWindow, preHours)) {
      return {
        ok: false,
        reason: "no_window",
        error: RESIDENTIAL_NO_WINDOW_MESSAGE,
      };
    }

    // Notice is measured from the arrival window in Eastern time.
    if (!meetsResidentialNotice(form.cleanDate, form.arrivalWindow, now)) {
      return {
        ok: false,
        reason: "notice",
        error: RESIDENTIAL_NOTICE_MESSAGE,
        earliestBookableDate: earliestBookableDate(preHours, now) ?? undefined,
      };
    }
  }

  // Validate the submitted shape and schema refinements.
  const parsed = residentialFormSchema.safeParse(form);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors as Record<
      string,
      string[] | undefined
    >;
    const first =
      Object.values(fieldErrors).find((messages) => messages?.length)?.[0] ??
      "Please check the details you entered and try again.";
    return { ok: false, reason: "validation", error: first, fieldErrors };
  }
  const data = parsed.data;

  const staffing = calculateJobStaffing({
    bedCount: data.bedrooms,
    bathCount: data.bathrooms,
    sqFt: data.sqft,
    laundryType: "none",
    hotTubServiceLevel: false,
    hotTubDeepClean: false,
  });
  const expectedHours = staffing.expectedHoursPerCleaner;

  const window = getArrivalWindow(data.arrivalWindow);
  if (!window) {
    return {
      ok: false,
      reason: "validation",
      error: "Please choose an arrival window.",
    };
  }

  // Reject malformed date or time values before payment.
  const arrival = getArrivalInstant(data.cleanDate, data.arrivalWindow);
  const deadline = getDeadlineInstant(
    data.cleanDate,
    data.arrivalWindow,
    expectedHours
  );
  if (!arrival || !deadline) {
    console.error("[residential-booking] unusable clean date/window", {
      cleanDate: data.cleanDate,
      arrivalWindow: data.arrivalWindow,
      expectedHours,
    });
    return {
      ok: false,
      reason: "validation",
      error: "We could not schedule that date and time. Please choose another.",
    };
  }

  // Price from server-side inputs only.
  const pricingInput = buildResidentialPricingInput({
    bedCount: data.bedrooms,
    bathCount: data.bathrooms,
    sqFt: data.sqft,
    petsAllowed: data.petsAllowed,
  });
  // The shared pricing engine accepts the rental form shape.
  const priceDetails = await pricingService.calculatePrice(
    pricingInput as unknown as Parameters<
      typeof pricingService.calculatePrice
    >[0]
  );

  // Keep quote refusal rules in one place.
  const refusal = residentialQuoteRefusal(priceDetails, {
    bedCount: data.bedrooms,
    bathCount: data.bathrooms,
    sqFt: data.sqft,
    petsAllowed: data.petsAllowed,
  });
  if (refusal) {
    return { ok: false, reason: refusal.reason, error: refusal.message };
  }

  const amountCents = Math.round(priceDetails.totalPerClean * 100);
  if (amountCents <= 0) {
    return {
      ok: false,
      reason: "pricing_unavailable",
      error:
        "We could not calculate a price for this home. Please check the details and try again.",
    };
  }

  return {
    ok: true,
    form: data,
    priceDetails,
    window,
    expectedHours,
    arrival,
    deadline,
    amountCents,
  };
}

async function resolveStripeCustomer(
  stripe: Stripe,
  form: { name?: string; email?: string; phoneNumber?: string },
  storedStripeCustomerId: string | null
): Promise<Stripe.Customer> {
  const profile = { name: form.name, phone: form.phoneNumber };

  if (storedStripeCustomerId) {
    try {
      const existing = await stripe.customers.retrieve(storedStripeCustomerId);
      if (!("deleted" in existing && existing.deleted)) {
        await stripe.customers.update(existing.id, profile);
        return existing as Stripe.Customer;
      }
    } catch (error) {
      console.warn(
        "[residential-booking] stored Stripe customer invalid, recovering:",
        storedStripeCustomerId,
        error
      );
    }
  }

  if (form.email) {
    const found = await stripe.customers.list({ email: form.email, limit: 1 });
    if (found.data.length > 0) {
      const stripeCustomer = found.data[0];
      await stripe.customers.update(stripeCustomer.id, profile);
      return stripeCustomer;
    }
  }

  return stripe.customers.create({
    email: form.email,
    name: form.name,
    phone: form.phoneNumber,
  });
}

/** Create a PaymentIntent for a valid residential booking. */
export async function createResidentialPaymentIntent(input: {
  formData: ResidentialFormData;
  /** The onboarding session token, which is what makes the charge idempotent. */
  sessionToken: string | null;
  now?: Date;
}): Promise<
  | {
      ok: true;
      clientSecret: string;
      /** What the card will be charged, after any promo code. */
      amountInCents: number;
      priceDetails: PriceDetails;
      promoCode: string | null;
      promoDiscountCents: number;
      /** The undiscounted total, so checkout can show what was struck through. */
      priceBeforeDiscountCents: number;
    }
  | ResidentialRefusal
> {
  const now = input.now ?? new Date();

  // Validate before creating any Stripe records.
  const quote = await evaluateResidentialBooking(input.formData, now);
  if (!quote.ok) return quote;

  const stripe = getStripe();
  if (!stripe) {
    return { ok: false, reason: "unavailable", error: SERVICE_UNAVAILABLE.stripe };
  }

  const db = getDbOrNull();
  if (!db) {
    return {
      ok: false,
      reason: "unavailable",
      error: SERVICE_UNAVAILABLE.database,
    };
  }

  const { form, priceDetails, amountCents } = quote;

  // Verify the address on the server.
  if (form.address) {
    const geocode = await geocodeAddressResult(form.address);

    if (
      geocode.status === "ok" &&
      !isPointInServiceArea(
        geocode.coordinates.latitude,
        geocode.coordinates.longitude
      )
    ) {
      return {
        ok: false,
        reason: "out_of_area",
        error:
          "The selected address is outside our current service area. Please contact CleanNami if you believe this is an error.",
      };
    }

    if (geocode.status === "not_found") {
      return {
        ok: false,
        reason: "out_of_area",
        error:
          "We could not verify that address. Please check it and try again, or contact CleanNami and we will help.",
      };
    }

    if (geocode.status === "unavailable") {
      console.error(
        `[residential-booking] service-area check skipped, geocoding unavailable (${geocode.reason}). Booking allowed WITHOUT service-area validation.`
      );
    }
  }

  let stripeCustomerId: string | null = null;
  if (form.email) {
    const existingCustomer = await db.query.customers.findFirst({
      where: eq(customers.email, form.email),
      columns: { stripeCustomerId: true },
    });
    if (existingCustomer?.stripeCustomerId) {
      stripeCustomerId = existingCustomer.stripeCustomerId;
    }
  }

  const stripeCustomer = await resolveStripeCustomer(
    stripe,
    form,
    stripeCustomerId
  );

  // Resolve promotional pricing before payment.
  let chargeAmountCents = amountCents;
  let appliedPromo:
    | { promoCodeId: string; code: string; discountCents: number }
    | null = null;

  const submittedPromoCode = form.promoCode?.trim() ?? "";
  if (submittedPromoCode) {
    let resolved;
    try {
      resolved = await resolvePromoCodeForAmount(
        submittedPromoCode,
        amountCents,
        form.email ?? ""
      );
    } catch (error) {
      console.error("[residential-booking] promo code lookup failed", error);
      return {
        ok: false,
        reason: "unavailable",
        error:
          "We could not check that promo code. Nothing has been charged — please try again.",
      };
    }

    const { evaluation, promoCodeId } = resolved;
    if (!evaluation.valid || !promoCodeId) {
      return {
        ok: false,
        reason: "validation",
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

  // Keep immutable booking details in Stripe metadata; never include access data.
  const metadata: Stripe.MetadataParam = {
    type: "residential_one_time",
    service_type: "residential_one_time",
    customer_name: form.name ?? "N/A",
    customer_email: form.email ?? "N/A",
    property_address: form.address ?? "N/A",
    property_details: `${form.bedrooms} bed, ${form.bathrooms} bath, ${form.sqft ?? "N/A"} sqft`,
    pets_allowed: form.petsAllowed ? "yes" : "no",
    clean_date: form.cleanDate ?? "",
    arrival_window: form.arrivalWindow ?? "",
    price_before_discounts_cents: String(amountCents),
    // Used to verify the final amount during completion.
    promo_code: appliedPromo?.code ?? "",
    promo_code_id: appliedPromo?.promoCodeId ?? "",
    promo_discount_cents: String(appliedPromo?.discountCents ?? 0),
  };

  let paymentIntent: Stripe.PaymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.create(
      {
        amount: chargeAmountCents,
        currency: "usd",
        customer: stripeCustomer.id,
        automatic_payment_methods: { enabled: true },
        metadata,
      },
      // Use the onboarding session when available to make retries safe.
      input.sessionToken
        ? {
            idempotencyKey: `res_${input.sessionToken}_${form.cleanDate}_${chargeAmountCents}`,
          }
        : undefined
    );
  } catch (error) {
    console.error("[residential-booking] PaymentIntent create failed", error);
    // Stripe reports idempotency failures through rawType.
    const stripeError = error as { rawType?: string; type?: string } | null;
    if (
      stripeError?.rawType === "idempotency_error" ||
      stripeError?.type === "StripeIdempotencyError"
    ) {
      return {
        ok: false,
        reason: "unavailable",
        error:
          "This booking has already been started at a different price. Refresh the page and try again.",
      };
    }
    return {
      ok: false,
      reason: "unavailable",
      error: "Could not initialize payment. Please try again.",
    };
  }

  if (!paymentIntent.client_secret) {
    return {
      ok: false,
      reason: "unavailable",
      error: "Could not initialize payment. Please contact support.",
    };
  }

  return {
    ok: true,
    clientSecret: paymentIntent.client_secret,
    // What the card will actually be charged, so the checkout total and the
    // Stripe amount can never disagree.
    amountInCents: chargeAmountCents,
    priceDetails,
    promoCode: appliedPromo?.code ?? null,
    promoDiscountCents: appliedPromo?.discountCents ?? 0,
    priceBeforeDiscountCents: amountCents,
  };
}

export type CompleteResidentialResult =
  | {
      success: true;
      data: {
        customer: { id: string };
        property: { id: string };
        job: { id: string };
        portalInviteEmailSent: boolean;
        alreadyCompleted?: boolean;
      };
    }
  | { success: false; error: string };

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Return property coordinates when geocoding succeeds. */
async function geocodeForProperty(
  address: string
): Promise<{ latitude: string; longitude: string } | null> {
  const result = await geocodeAddressResult(address);
  if (result.status !== "ok") {
    console.warn(
      `[residential-booking] geocode unusable (${result.status}) for: ${address}`
    );
    return null;
  }
  return {
    latitude: result.coordinates.latitude.toString(),
    longitude: result.coordinates.longitude.toString(),
  };
}

/** Verify a paid booking and create its customer, property, and job. */
export async function completeResidentialBooking(
  formData: ResidentialFormData,
  paymentIntentId: string
): Promise<CompleteResidentialResult> {
  // Refund only after the intent has been verified for this booking.
  let paymentVerified = false;
  let verifiedDb: ReturnType<typeof getDbOrNull> = null;

  try {
    const stripe = getStripe();
    if (!stripe) return { success: false, error: SERVICE_UNAVAILABLE.stripe };

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== "succeeded") {
      return {
        success: false,
        error:
          "Payment has not completed successfully. Please contact support before booking again.",
      };
    }

    if (paymentIntent.currency !== "usd") {
      return {
        success: false,
        error: "Payment currency mismatch. Please contact support.",
      };
    }

    const stripeCustomerId =
      typeof paymentIntent.customer === "string" ? paymentIntent.customer : null;
    if (!stripeCustomerId) {
      return {
        success: false,
        error:
          "Critical: could not find a Stripe Customer ID associated with this payment.",
      };
    }

    // Match the submitted booking to immutable checkout metadata.
    const submitted = normalizeResidentialFormData(formData);
    const expectedPropertyDetails = `${submitted.bedrooms} bed, ${submitted.bathrooms} bath, ${submitted.sqft ?? "N/A"} sqft`;
    if (
      paymentIntent.metadata?.type !== "residential_one_time" ||
      paymentIntent.metadata?.customer_email?.toLowerCase() !==
        (submitted.email ?? "").toLowerCase() ||
      paymentIntent.metadata?.property_address?.trim().toLowerCase() !==
        (submitted.address ?? "").trim().toLowerCase() ||
      paymentIntent.metadata?.clean_date !== submitted.cleanDate ||
      paymentIntent.metadata?.arrival_window !== submitted.arrivalWindow ||
      paymentIntent.metadata?.pets_allowed !==
        (submitted.petsAllowed ? "yes" : "no") ||
      paymentIntent.metadata?.property_details !== expectedPropertyDetails
    ) {
      return {
        success: false,
        error:
          "This payment does not match the submitted booking. Please contact support.",
      };
    }

    // A verified payment is refunded if finalization fails.
    paymentVerified = true;

    verifiedDb = getDbOrNull();
    if (!verifiedDb) throw new Error(SERVICE_UNAVAILABLE.database);
    const db = verifiedDb;

    // Return an existing booking before evaluating current rules.
    const replayed = await db.query.jobs.findFirst({
      where: eq(jobs.paymentIntentId, paymentIntentId),
      columns: { id: true, propertyId: true },
      with: { property: { columns: { customerId: true } } },
    });

    if (replayed?.propertyId && replayed.property?.customerId) {
      const invite = await inviteCustomerToPortalAfterPayment({
        email: submitted.email!,
        name: submitted.name ?? "",
      });
      return {
        success: true,
        data: {
          customer: { id: replayed.property.customerId },
          property: { id: replayed.propertyId },
          job: { id: replayed.id },
          portalInviteEmailSent: invite.success ? invite.emailSent : false,
          alreadyCompleted: true,
        },
      };
    }

    // Re-check current booking rules before writing.
    const quote = await evaluateResidentialBooking(formData);
    if (!quote.ok) throw new Error(quote.error);

    const { form, amountCents } = quote;

    const piEmail =
      typeof paymentIntent.metadata?.customer_email === "string"
        ? paymentIntent.metadata.customer_email
        : null;
    if (!piEmail || piEmail.toLowerCase() !== (form.email ?? "").toLowerCase()) {
      return {
        success: false,
        error:
          "This payment does not match the submitted booking. Please contact support.",
      };
    }

    const piAddress =
      typeof paymentIntent.metadata?.property_address === "string"
        ? paymentIntent.metadata.property_address
        : null;
    if (
      !piAddress ||
      piAddress.trim().toLowerCase() !== (form.address ?? "").trim().toLowerCase()
    ) {
      return {
        success: false,
        error:
          "This payment does not match the submitted property address. Please contact support.",
      };
    }

    // Compare the current server quote with the amount charged.
    const metadataDiscountCents = Number(
      paymentIntent.metadata?.promo_discount_cents ?? 0
    );
    const promoCodeId = paymentIntent.metadata?.promo_code_id || null;
    const promoCode = paymentIntent.metadata?.promo_code || null;

    if (!Number.isFinite(metadataDiscountCents) || metadataDiscountCents < 0) {
      return {
        success: false,
        error:
          "This payment carries an unreadable discount. Please contact support.",
      };
    }

    const expectedChargeCents = amountCents - metadataDiscountCents;
    if (paymentIntent.amount !== expectedChargeCents) {
      return {
        success: false,
        error:
          "The payment amount does not match the expected price for this booking. Please contact support.",
      };
    }

    const coordinates = await geocodeForProperty(form.address!);

    // Residential uses these existing fields for its arrival and finish times.
    const windowStartTime = minutesToTimeOfDay(quote.window.startMinutes);
    const mustFinishBeforeTime = minutesToTimeOfDay(
      mustFinishBeforeMinutes(quote.window, quote.expectedHours)
    );

    // Build staffing before opening the transaction.
    const hotTubTimeAdditions = await loadHotTubTimeAdditions();
    const staffing = buildJobStaffingUpdate({
      property: {
        bedCount: form.bedrooms!,
        bathCount: String(form.bathrooms!),
        sqFt: form.sqft ?? null,
        laundryType: "none",
        hotTubServiceLevel: false,
        hotTubDrainCadence: null,
        petsAllowed: form.petsAllowed ?? false,
      },
      checkInTime: quote.arrival,
      subscriptionStart: quote.arrival,
      hotTubTimeAdditions,
    });

    const addonsSnapshot = {
      ...staffing.addonsSnapshot,
      // Kept for display; timestamps remain the source of truth.
      arrivalWindow: quote.window.key,
    };

    // Access details must not enter the job snapshot.
    for (const forbidden of [
      "entryMethod",
      "entryInstructions",
      "parkingInstructions",
    ]) {
      if (forbidden in addonsSnapshot) {
        throw new Error(
          `addons_snapshot must never carry ${forbidden}`
        );
      }
    }

    const result = await db.transaction(async (tx) => {
      const [customer] = await tx
        .insert(customers)
        .values({
          name: form.name!,
          email: form.email!,
          phone: form.phoneNumber,
          stripeCustomerId,
          portalAccessEnabled: true,
        })
        .onConflictDoUpdate({
          target: customers.email,
          set: {
            name: form.name!,
            phone: form.phoneNumber,
            stripeCustomerId,
            portalAccessEnabled: true,
            updatedAt: new Date(),
          },
        })
        .returning();

      const propertyValues: Record<string, unknown> = {
        customerId: customer.id,
        address: form.address!,
        sqFt: form.sqft,
        bedCount: form.bedrooms,
        bathCount: String(form.bathrooms),
        // Residential does not include laundry or hot-tub work.
        laundryType: "none",
        laundryLoads: null,
        hasHotTub: false,
        hotTubServiceLevel: false,
        hotTubDrain: false,
        hotTubDrainCadence: null,
        useDefaultChecklist: true,
        iCalUrl: null,
        serviceType: "residential_one_time",
        petsAllowed: form.petsAllowed ?? false,
        // Access details live only on the property.
        entryMethod: form.entryMethod ?? null,
        entryInstructions: form.entryInstructions ?? null,
        parkingInstructions: form.parkingInstructions ?? null,
        // Customer instructions are not access credentials.
        specialInstructions: form.specialNotes ?? null,
        defaultCheckOutTime: windowStartTime,
        defaultCheckInTime: mustFinishBeforeTime,
      };

      if (coordinates) {
        propertyValues.latitude = coordinates.latitude;
        propertyValues.longitude = coordinates.longitude;
        propertyValues.geocodedAt = new Date();
      }

      const [property] = await tx
        .insert(properties)
        .values(propertyValues as typeof properties.$inferInsert)
        .returning();

      if (!property) throw new Error("properties insert returned no rows");

      // Synthetic UID keeps this job out of calendar cancellation detection.
      const [job] = await tx
        .insert(jobs)
        .values({
          subscriptionId: null,
          propertyId: property.id,
          serviceType: "residential_one_time",
          jobSource: "public_residential_booking",
          calendarEventUid: `res_${randomUUID()}`,
          checkInTime: quote.arrival,
          checkOutTime: quote.deadline,
          status: "unassigned",
          expectedHours: staffing.expectedHours,
          addonsSnapshot,
          paymentIntentId,
          paymentStatus: "captured",
          // Keep the promo reference with the paid job.
          promoCodeId,
          notes: `[System] Residential one-time clean, prepaid. PaymentIntent ${paymentIntentId}.`,
        })
        .returning({ id: jobs.id });

      if (!job) throw new Error("jobs insert returned no rows");

      return { customer, property, job };
    });

    const accountResult = await inviteCustomerToPortalAfterPayment({
      email: form.email!,
      name: form.name!,
    });

    // Admin alert is best-effort.
    try {
      await notifyAdmins({
        type: "booking_alert",
        title: "New one-time residential booking",
        message: `${form.name} booked a one-time clean at ${form.address} for ${form.cleanDate} (${quote.window.label}). Paid ${formatUsd(amountCents)}.`,
        jobId: result.job.id,
        url: `/admin/job-oversight/${result.job.id}`,
      });
    } catch (err) {
      console.error("[residential-booking] admin notification failed:", err);
    }

    // Record promo redemption after the booking exists.
    if (promoCodeId && promoCode) {
      try {
        await recordPromoRedemption({
          promoCodeId,
          code: promoCode,
          customerEmail: form.email ?? "",
          customerId: result.customer.id,
          subscriptionId: null,
          jobId: result.job.id,
          paymentIntentId,
          originalAmountCents: amountCents,
          discountAmountCents: metadataDiscountCents,
          finalAmountCents: expectedChargeCents,
        });
      } catch (err) {
        console.error(
          "[residential-booking] promo redemption record failed; the booking stands:",
          err
        );
      }
    }

    // Confirmation email is best-effort.
    try {
      await sendResidentialBookingConfirmationEmail({
        to: form.email!,
        name: form.name,
        propertyAddress: form.address!,
        cleanDate: form.cleanDate!,
        arrivalWindowLabel: quote.window.label,
        amount: formatUsd(expectedChargeCents),
        petsAllowed: form.petsAllowed ?? false,
        petFeeApplied: quote.priceDetails.petFee > 0,
        entryMethod: form.entryMethod ?? null,
      });
    } catch (err) {
      console.error("[residential-booking] confirmation email failed:", err);
    }

    return {
      success: true,
      data: {
        customer: { id: result.customer.id },
        property: { id: result.property.id },
        job: { id: result.job.id },
        portalInviteEmailSent: accountResult.success
          ? accountResult.emailSent
          : false,
      },
    };
  } catch (error) {
    console.error(
      "CRITICAL: residential booking failed after successful payment.",
      {
        paymentIntentId,
        error: error instanceof Error ? error.message : String(error),
      }
    );

    // A concurrent completion may have created the job first.
    if (paymentVerified && verifiedDb && isUniqueViolation(error)) {
      try {
        const replayed = await verifiedDb.query.jobs.findFirst({
          where: eq(jobs.paymentIntentId, paymentIntentId),
          columns: { id: true, propertyId: true },
          with: { property: { columns: { customerId: true } } },
        });
        if (replayed?.propertyId && replayed.property?.customerId) {
          return {
            success: true,
            data: {
              customer: { id: replayed.property.customerId },
              property: { id: replayed.propertyId },
              job: { id: replayed.id },
              portalInviteEmailSent: false,
              alreadyCompleted: true,
            },
          };
        }
      } catch (replayLookupError) {
        console.error(
          "[residential-booking] could not read concurrent completion",
          replayLookupError
        );
      }
    }

    // Refund a verified payment when finalization fails.
    if (paymentVerified) {
      await voidCharge({
        paymentIntentId,
        paymentStatus: "captured",
        context: "residential booking",
      });
      return {
        success: false,
        error:
          "We took payment but could not save your booking, so the charge has been refunded. Please try again, or contact CleanNami if you do not see the refund.",
      };
    }

    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to save your booking. Please contact support.",
    };
  }
}
