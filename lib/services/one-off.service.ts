import "server-only";

import { randomUUID } from "crypto";
import { db } from "@/db";
import { customers, jobs, properties } from "@/db/schemas";
import { PricingService } from "@/lib/services/pricing.service";
import { buildJobStaffingUpdate } from "@/lib/pricing/apply-job-staffing";
import { loadHotTubTimeAdditions } from "@/lib/pricing/hot-tub-time";
import { getStripe } from "@/lib/stripe/get-stripe";
import { getStartOfTodayEastern } from "@/lib/time/eastern";
import {
  recordPromoRedemption,
  resolvePromoCodeForAmount,
} from "@/lib/services/promo-code.service";
import { fromZonedTime } from "date-fns-tz";
import { addDays } from "date-fns";
import { and, eq } from "drizzle-orm";

const EASTERN_TZ = "America/New_York";
/** Sensible default lead time for a one-off so it can be staffed/assigned. */
const ONE_OFF_BUFFER_DAYS = 2;

export type BookOneOffInput = {
  propertyId: string;
  date: string;
  /** Optional customer-entered promo code; discounts this one clean only. */
  promoCode?: string;
};
export type BookOneOffResult =
  | {
      success: true;
      jobId: string;
      amountCents: number;
      promoCode?: string;
      promoDiscountCents?: number;
    }
  | { success: false; error: string };

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
    subscriptionMonths: 1,
    priceOverrideCents: property.priceOverrideCents,
  } as any);

  if (priceDetails.pricingUnavailable || priceDetails.isCustomQuote) {
    return {
      ok: false,
      error: "This property needs a custom quote — please contact CleanNami.",
    };
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

  // Arrival anchor = the property's guest-checkout time; deadline = guest
  // check-in time (defaults 09:00 / 16:00 ET), both on the chosen date.
  const checkOutTime = property.defaultCheckOutTime ?? "09:00:00";
  const checkInTime = property.defaultCheckInTime ?? "16:00:00";
  const arrival = fromZonedTime(`${input.date}T${checkOutTime}`, EASTERN_TZ);
  const deadline = fromZonedTime(`${input.date}T${checkInTime}`, EASTERN_TZ);

  const earliest = addDays(getStartOfTodayEastern(), ONE_OFF_BUFFER_DAYS);
  if (arrival < earliest) {
    return {
      success: false,
      error: `Please choose a date at least ${ONE_OFF_BUFFER_DAYS} days out.`,
    };
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

    const paymentMethods = await stripe.paymentMethods.list({
      customer: customer.stripeCustomerId,
      type: "card",
    });
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
    const { evaluation, promoCodeId } = await resolvePromoCodeForAmount(
      submittedPromoCode,
      amountCents,
      customer.email ?? ""
    );

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
    if ((err as { code?: string } | null)?.code === "idempotency_error") {
      return {
        success: false,
        error:
          "You have already booked a clean for this property on this date. Refresh to see it.",
      };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Payment failed.",
    };
  }
  }

  const hotTubTimeAdditions = await loadHotTubTimeAdditions();
  const staffing = buildJobStaffingUpdate({
    property: {
      bedCount: property.bedCount,
      bathCount: property.bathCount,
      sqFt: property.sqFt,
      laundryType: property.laundryType,
      hotTubServiceLevel: property.hotTubServiceLevel,
      hotTubDrainCadence: property.hotTubDrainCadence,
    },
    checkInTime: arrival,
    subscriptionStart: arrival,
    hotTubTimeAdditions,
  });

  const [job] = await db
    .insert(jobs)
    .values({
      subscriptionId: null,
      propertyId: property.id,
      checkInTime: arrival,
      checkOutTime: deadline,
      calendarEventUid: `oneoff_${randomUUID()}`,
      status: "unassigned",
      expectedHours: staffing.expectedHours,
      addonsSnapshot: staffing.addonsSnapshot,
      promoCodeId: appliedPromo?.promoCodeId ?? null,
      notes: skipPayment
        ? `[System] One-off clean booked with payment skipped (comped account). No charge taken.`
        : `[System] One-off clean prepaid. PaymentIntent ${paymentIntentId}.`,
    })
    .returning({ id: jobs.id });

  // Best-effort bookkeeping, after the money moved and the job exists: this is
  // what burns the customer's single redemption of this code.
  if (appliedPromo) {
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
  }

  return {
    success: true,
    jobId: job.id,
    amountCents: chargeAmountCents,
    promoCode: appliedPromo?.code,
    promoDiscountCents: appliedPromo?.discountCents,
  };
}
