import "server-only";

import { randomUUID } from "crypto";
import { db } from "@/db";
import { customers, jobs, properties } from "@/db/schemas";
import { PricingService } from "@/lib/services/pricing.service";
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
import { and, eq } from "drizzle-orm";
import { createChecklistSnapshot } from "@/lib/cleaner/checklist-snapshot";

const EASTERN_TZ = "America/New_York";
/** Sensible default lead time for a one-off so it can be staffed/assigned. */
const ONE_OFF_BUFFER_DAYS = 2;

export type BookOneOffInput = {
  propertyId: string;
  date: string;
  /** Optional customer-entered promo code; discounts this one clean only. */
  promoCode?: string;
  /**
   * Arrival window key, e.g. "9-11". Required for a residential property and
   * ignored for a rental, whose timing comes from the property's guest
   * check-in/check-out times instead.
   */
  arrivalWindow?: string;
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
      /**
       * An infrastructure fault rather than a business refusal. The route maps
       * this to 5xx so "we could not reach Stripe" is not reported to the
       * customer as "your booking was invalid".
       */
      unexpected?: true;
      /** Explicit override when the default 400/500 split is wrong. */
      status?: number;
    };

type PricedProperty = NonNullable<
  Awaited<ReturnType<typeof db.query.properties.findFirst>>
>;

/**
 * Standard engine, single clean — no subscription-term discount (there is no
 * term), admin per-property override still honoured. Shared by the booking
 * call and the promo preview so both quote off exactly the same number.
 */
async function priceOneOffCents(
  property: PricedProperty
): Promise<{ ok: true; amountCents: number } | { ok: false; error: string }> {
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
    // Item 7. The `as any` below means the compiler cannot ask for this, so it
    // is here by hand: omitting it under-charges every pet property by $10 on
    // a path that actually takes the customer's money.
    petsAllowed: property.petsAllowed,
    subscriptionMonths: 1,
    priceOverrideCents: property.priceOverrideCents,
  } as any);

  if (priceDetails.pricingUnavailable || priceDetails.isCustomQuote) {
    return { ok: false, error: CUSTOM_QUOTE_EXISTING_PROPERTY_MESSAGE };
  }

  // A laundry service with no load count prices laundry at $0, so the number
  // below would be wrong rather than merely unknown. A human is waiting on this
  // answer, so refuse rather than quietly under-charging them.
  if (priceDetails.laundryLoadsMissing) {
    return { ok: false, error: LAUNDRY_LOADS_INCOMPLETE_MESSAGE };
  }

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
      eq(properties.customerId, customerId)
    ),
    with: { checklistFiles: true },
  });
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

/**
 * Price a code against a one-off before the customer commits to the charge.
 * Preview only — `bookOneOffClean` re-resolves the code authoritatively, so a
 * stale answer here can never decide what is actually charged.
 */
export async function previewOneOffPromoCode(
  customerId: string,
  propertyId: string,
  rawCode: string
): Promise<OneOffPromoPreview> {
  const property = await loadOwnedProperty(customerId, propertyId);
  if (!property) return { valid: false, message: "Property not found." };

  const priced = await priceOneOffCents(property);
  if (!priced.ok) return { valid: false, message: priced.error };

  const customer = await db.query.customers.findFirst({
    where: eq(customers.id, customerId),
    columns: { email: true },
  });

  const { evaluation } = await resolvePromoCodeForAmount(
    rawCode,
    priced.amountCents,
    customer?.email ?? ""
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

/**
 * Task 1.6 — book a single (non-recurring) clean for an existing customer's
 * property from the customer portal. Sensible defaults / best practice:
 *  - priced with the standard engine but NO subscription-term discount (single
 *    clean); an admin per-property override still applies.
 *  - charged up front on the saved card (prepaid), like the first clean.
 *  - the job is created with no subscription and a synthetic calendar UID, and
 *    flows through assignment → evidence → the prepaid payout path so the
 *    cleaner is paid on completion. Money is collected here, so the job carries
 *    no paymentIntentId (prepaid), mirroring the onboarding first clean.
 */
export async function bookOneOffClean(
  customerId: string,
  input: BookOneOffInput
): Promise<BookOneOffResult> {
  const property = await loadOwnedProperty(customerId, input.propertyId);
  if (!property) return { success: false, error: "Property not found." };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    return { success: false, error: "Please choose a valid date." };
  }

  // Timing is the one thing the two service types genuinely do not share, so
  // it branches here and nowhere else.
  //
  // A rental turnover is bounded by the guests: arrive at checkout, finish
  // before check-in, and two days is enough notice to staff it. That path is
  // untouched below.
  //
  // A home has no guests to work around. The customer picks an arrival window,
  // and the promise made to them on the public site is 48 hours measured from
  // when the cleaner actually arrives. Measuring from midnight instead — which
  // is what the rental rule does — sells as little as 34 hours' notice as 48,
  // for any booking made after 10am Eastern. Same property, same date, two
  // different answers depending on which page the customer happened to use.
  const isResidential = property.serviceType === "residential_one_time";
  const arrivalWindow = input.arrivalWindow?.trim() || null;

  let arrival: Date;
  // The rental deadline is known here; the residential one needs the job's
  // expected hours and so is computed once staffing has run, still before any
  // money moves.
  let rentalDeadline: Date | null = null;

  if (isResidential) {
    // Returns null rather than an Invalid Date, which matters: `Invalid Date <
    // earliest` is false, so a bad value would sail past a comparison and only
    // be caught by Postgres after the card was charged.
    const instant = getArrivalInstant(input.date, arrivalWindow);
    if (!instant) {
      return {
        success: false,
        error: "Please choose an arrival window for this clean.",
      };
    }
    arrival = instant;

    // The same predicate the public residential flow uses, so the two cannot
    // drift apart again.
    if (!meetsResidentialNotice(input.date, arrivalWindow)) {
      return { success: false, error: RESIDENTIAL_NOTICE_MESSAGE };
    }
  } else {
    // Arrival anchor = the property's guest-checkout time; deadline = guest
    // check-in time (defaults 09:00 / 16:00 ET), both on the chosen date.
    const checkOutTime = property.defaultCheckOutTime ?? "09:00:00";
    const checkInTime = property.defaultCheckInTime ?? "16:00:00";
    arrival = fromZonedTime(`${input.date}T${checkOutTime}`, EASTERN_TZ);
    rentalDeadline = fromZonedTime(`${input.date}T${checkInTime}`, EASTERN_TZ);

    // A malformed time on the property yields an Invalid Date, and `Invalid
    // Date < earliest` is false — so it sails past the buffer check below and
    // is only rejected by Postgres at the insert, which happens AFTER the card
    // is charged. Catch it here, while nothing has been paid.
    if (Number.isNaN(arrival.getTime()) || Number.isNaN(rentalDeadline.getTime())) {
      console.error(
        `[bookOneOffClean] property ${property.id} has unusable check-in/check-out times:`,
        { checkInTime, checkOutTime }
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

  // Price it: standard engine, single clean (no term discount), property
  // override honoured. The Stripe floor is checked against the FULL price so a
  // promo code can never mask a misconfigured property.
  const priced = await priceOneOffCents(property);
  if (!priced.ok) return { success: false, error: priced.error };
  const amountCents = priced.amountCents;

  const customer = await db.query.customers.findFirst({
    where: eq(customers.id, customerId),
    columns: { stripeCustomerId: true, email: true, skipPayment: true },
  });

  // `skip_payment` is how a comped or demo account transacts without a card.
  // `completeOnboarding()` has always honoured it; this path did not, so those
  // customers could not book a one-off at all — they hit "Payment is not set
  // up for your account" with no way forward.
  const skipPayment = customer?.skipPayment === true;

  const stripe = getStripe();
  let paymentMethodId: string | undefined;

  if (!skipPayment) {
    if (!stripe || !customer?.stripeCustomerId) {
      return {
        success: false,
        error: "Payment is not set up for your account.",
      };
    }

    // Unprotected, this was the most likely source of the raw HTTP 500 the
    // client hit: a Stripe customer id that does not resolve in the mode the
    // deployment is running throws here, and the throw escaped all the way out
    // of the route.
    let paymentMethods;
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

  // Customer-entered promo code — resolved authoritatively here, never trusting
  // the preview. Discounts this single clean, which is the whole unit being
  // bought, and burns the customer's one redemption of this code.
  //
  // Fails LOUD, unlike the recurring pre-authorize cron: there, nobody is
  // watching and a stale code must not block a real charge; here the customer
  // just typed the code and is about to be charged, so silently billing them
  // full price would be the wrong answer.
  const submittedPromoCode = input.promoCode?.trim() ?? "";
  let chargeAmountCents = amountCents;
  let appliedPromo: { promoCodeId: string; code: string; discountCents: number } | null =
    null;

  if (submittedPromoCode) {
    let resolved;
    try {
      resolved = await resolvePromoCodeForAmount(
        submittedPromoCode,
        amountCents,
        customer.email ?? ""
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

  // Staffing is pure computation over data already in hand, and it used to sit
  // BETWEEN the charge and the insert — so a failure here meant a charged card
  // and no job. Everything that can fail now happens before any money moves,
  // leaving the insert as the single post-charge write.
  let staffing;
  try {
    const hotTubTimeAdditions = await loadHotTubTimeAdditions();
    staffing = buildJobStaffingUpdate({
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

  // A home's must-finish-before is the window END plus the job's expected
  // hours — never the window end alone, which would promise a finish time no
  // cleaner could meet. That needs staffing, which is why this sits here; it is
  // still ahead of every line that moves money.
  const deadline = isResidential
    ? getDeadlineInstant(
        input.date,
        arrivalWindow,
        staffing.staffing.expectedHoursPerCleaner
      )
    : rentalDeadline;

  if (!deadline) {
    console.error("[bookOneOffClean] unusable arrival window or expected hours", {
      date: input.date,
      arrivalWindow,
      expectedHours: staffing.staffing.expectedHoursPerCleaner,
    });
    return {
      success: false,
      error: "We could not schedule that date and time. Please choose another.",
    };
  }

  // Null on the skip-payment path: no money moved, so there is no intent to
  // record. The job then carries no paymentIntentId, which is exactly what
  // capture-and-payout treats as prepaid — the cleaner is still paid.
  let paymentIntentId: string | null = null;
  if (skipPayment) {
    chargeAmountCents = 0;
  } else {
  try {
    const paymentIntent = await stripe!.paymentIntents.create(
      {
        amount: chargeAmountCents,
        currency: "usd",
        // Both are guaranteed by the `!skipPayment` guard above, which returns
        // early when either is missing.
        customer: customer.stripeCustomerId!,
        payment_method: paymentMethodId!,
        off_session: true,
        confirm: true,
        metadata: {
          type: "one_off",
          propertyId: property.id,
          customerId,
          promo_code: appliedPromo?.code ?? "",
          promo_discount_cents: String(appliedPromo?.discountCents ?? 0),
        },
      },
      // Same customer/property/date never double-charges on a retry. The promo
      // code is deliberately NOT part of the key: keeping it stable is what
      // makes a re-submit collapse onto the existing charge instead of billing
      // twice at a different amount.
      { idempotencyKey: `oneoff_${customerId}_${property.id}_${input.date}` }
    );
    if (paymentIntent.status !== "succeeded") {
      return { success: false, error: "Payment could not be completed." };
    }
    paymentIntentId = paymentIntent.id;
  } catch (err) {
    console.error("[bookOneOffClean] charge failed", err);
    // Re-booking the same property/date at a different amount (e.g. first
    // without a code, then with one) reuses the key with different parameters.
    // Stripe rejects that rather than charging again — say what actually
    // happened instead of surfacing the raw API wording.
    // The value lives on `rawType`, not `code`. Stripe's SDK wraps the API's
    // `idempotency_error` in a StripeIdempotencyError whose `code` is
    // undefined, so checking `code` never matched and the raw API wording was
    // returned instead — including the idempotency key itself, which embeds
    // the customer and property ids. Verified against the live test API.
    const stripeError = err as
      | { rawType?: string; type?: string; message?: string }
      | null;
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

    // A declined card is the customer's to act on and Stripe writes those
    // messages for them, so that one is passed through. Anything else is ours,
    // and its wording is written for us — it can carry request ids, parameter
    // names and internal identifiers, none of which belong in a browser.
    if (stripeError?.type === "StripeCardError" && stripeError.message) {
      return { success: false, error: stripeError.message };
    }
    return {
      success: false,
      unexpected: true,
      error:
        "We could not complete the payment. Nothing has been charged — please try again, or contact CleanNami if you were charged.",
    };
  }
  }

  // The single write after the money moved. If it fails the customer has paid
  // for nothing, so the charge is refunded rather than left stranded — a
  // phantom charge is visible in Stripe and reconcilable, which is why this
  // ordering is preferred over insert-first (a phantom *unpaid* job would be
  // picked up by assignment and paid out to a cleaner as if prepaid).
  let job: { id: string } | undefined;
  try {
    [job] = await db
      .insert(jobs)
      .values({
        subscriptionId: null,
        propertyId: property.id,
        checkInTime: arrival,
        checkOutTime: deadline,
        calendarEventUid: `oneoff_${randomUUID()}`,
        status: "unassigned",
        // Two columns answering two different questions, and it is worth being
        // precise about which is which.
        //
        // `service_type` is WHAT KIND OF CLEAN this is, and only the property
        // can say. It drives the admin label and filter, the cleaner's badge,
        // and the checklist's default. Hard-coding the rental literal here was
        // harmless while every property was a rental; once a homeowner could
        // re-book from the portal it started badging their clean "Vacation
        // Rental Turnover" while the checklist — which reads the property —
        // correctly showed the residential items. The checklist was never the
        // broken half.
        //
        // `job_source` is HOW THIS JOB GOT CREATED, and only the code path can
        // say. Nothing user-facing depends on it; it exists so "where did this
        // come from" is answerable without reverse-engineering
        // `calendar_event_uid`.
        serviceType: property.serviceType,
        jobSource: "customer_one_off",
        expectedHours: staffing.expectedHours,
        addonsSnapshot: isResidential
          ? { ...staffing.addonsSnapshot, arrivalWindow }
          : staffing.addonsSnapshot,
        // Preserve the feedback integration's immutable issued checklist while
        // adding the residential arrival-window pricing snapshot.
        checklistSnapshot: createChecklistSnapshot(property, property.checklistFiles),
        promoCodeId: appliedPromo?.promoCodeId ?? null,
        notes: skipPayment
          ? `[System] One-off clean booked with payment skipped (comped account). No charge taken.`
          : `[System] One-off clean prepaid. PaymentIntent ${paymentIntentId}.`,
      })
      .returning({ id: jobs.id });

    // `.returning()` yielding nothing would otherwise surface as a confusing
    // "cannot read properties of undefined" further down, after the charge.
    if (!job) throw new Error("jobs insert returned no rows");
  } catch (err) {
    console.error(
      "[bookOneOffClean] job insert failed AFTER charge — refunding",
      err
    );
    await voidCharge({
      paymentIntentId,
      // A one-off PaymentIntent is created with `confirm: true`, so it is
      // captured immediately; there is no job row to read a status from.
      paymentStatus: "captured",
      context: "one-off booking",
    });
    return {
      success: false,
      unexpected: true,
      error:
        "We took payment but could not save your booking, so the charge has been refunded. Please try again, or contact CleanNami if you do not see the refund.",
    };
  }

  // Best-effort bookkeeping, after the money moved and the job exists: this is
  // what burns the customer's single redemption of this code. Never allowed to
  // fail the booking — the clean is paid for and scheduled by this point.
  if (appliedPromo) {
    try {
      await recordPromoRedemption({
        promoCodeId: appliedPromo.promoCodeId,
        code: appliedPromo.code,
        customerEmail: customer.email ?? "",
        customerId,
        subscriptionId: null,
        jobId: job.id,
        // `promo_redemptions.payment_intent_id` is the idempotency key, so it
        // cannot be null. With no charge there is no intent, so the job id
        // stands in — still unique per booking, so the code is burned exactly
        // once here too.
        paymentIntentId: paymentIntentId ?? `skip_payment_${job.id}`,
        originalAmountCents: amountCents,
        discountAmountCents: appliedPromo.discountCents,
        finalAmountCents: chargeAmountCents,
      });
    } catch (err) {
      console.error(
        `[bookOneOffClean] promo redemption bookkeeping failed for job ${job.id}`,
        err
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
