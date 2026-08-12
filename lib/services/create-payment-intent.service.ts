import "server-only";

import { PricingService } from "@/lib/services/pricing.service";
import { PriceDetails, SignupFormData } from "@/lib/validations/bookng-modal";
import { normalizeSignupFormDataForPricing } from "@/lib/validations/bookng-modal/serialize-signup-form";
import {
  applyFirstCleanDiscount,
  getFirstCleanDiscountPercent,
} from "@/lib/pricing/first-clean-discount";
import { resolvePromoCodeForAmount } from "@/lib/services/promo-code.service";
import { customers } from "@/db/schemas";
import { getDbOrNull } from "@/db";
import { eq } from "drizzle-orm";
import { getStripe } from "@/lib/stripe/get-stripe";
import { SERVICE_UNAVAILABLE } from "@/lib/env/messages";
import { geocodeAddressResult } from "@/lib/services/google-maps/geocoding";
import { isPointInServiceArea } from "@/lib/google-maps/serviceArea/index.ts";
import { CUSTOM_QUOTE_BOOKING_MESSAGE } from "@/lib/pricing/custom-quote-message";
import { LAUNDRY_LOADS_REQUIRED_MESSAGE } from "@/lib/validations/laundry-loads";
import { getStartOfTodayEastern } from "@/lib/time/eastern";
import { addDays } from "date-fns";
import Stripe from "stripe";

const pricingService = new PricingService();

/** Mandatory setup window before the first clean; re-checked server-side. */
const FIRST_CLEAN_BUFFER_DAYS = 7;

async function resolveStripeCustomer(
  stripe: Stripe,
  formData: SignupFormData,
  storedStripeCustomerId: string | null
): Promise<Stripe.Customer> {
  const profile = {
    name: formData.name,
    phone: formData.phoneNumber,
  };

  if (storedStripeCustomerId) {
    try {
      const existing = await stripe.customers.retrieve(storedStripeCustomerId);
      if (!("deleted" in existing && existing.deleted)) {
        await stripe.customers.update(existing.id, profile);
        return existing as Stripe.Customer;
      }
    } catch (error) {
      console.warn(
        "[createPaymentIntentForSignup] Stored Stripe customer invalid, recovering:",
        storedStripeCustomerId,
        error
      );
    }
  }

  if (formData.email) {
    const existingStripeCustomers = await stripe.customers.list({
      email: formData.email,
      limit: 1,
    });

    if (existingStripeCustomers.data.length > 0) {
      const stripeCustomer = existingStripeCustomers.data[0];
      await stripe.customers.update(stripeCustomer.id, profile);
      return stripeCustomer;
    }
  }

  return stripe.customers.create({
    email: formData.email,
    name: formData.name,
    phone: formData.phoneNumber,
  });
}

/**
 * What the prepaid first clean costs before any promo code: the calculated
 * per-clean price (term discount already inside it) less the admin's global
 * first-clean discount.
 *
 * Exported so the promo-preview route quotes off exactly the same number the
 * PaymentIntent will be created from, instead of re-deriving "what the first
 * clean costs" a second way and drifting.
 */
export async function quoteFirstCleanChargeCents(
  formData: SignupFormData
): Promise<
  | {
      ok: true;
      priceDetails: PriceDetails;
      priceBeforeDiscountsCents: number;
      chargeBeforePromoCents: number;
      firstCleanDiscountPercent: number;
    }
  | { ok: false; error: string }
> {
  const normalized = normalizeSignupFormDataForPricing(formData);
  const priceDetails = await pricingService.calculatePrice(normalized);

  if (priceDetails.isCustomQuote) {
    // Was worded as sq ft only, which misread the bed/bath case as a sq ft
    // problem. Shared wording now covers both reasons.
    return { ok: false, error: CUSTOM_QUOTE_BOOKING_MESSAGE };
  }

  // The pre-charge barrier for laundry loads. `signupFormSchema`'s refine is a
  // backstop only: its single server-side parse runs in complete-onboarding,
  // which is AFTER the card is charged, so a rejection there strands a paid
  // customer. Refusing here costs them a form correction instead.
  if (priceDetails.laundryLoadsMissing) {
    return { ok: false, error: LAUNDRY_LOADS_REQUIRED_MESSAGE };
  }

  const priceBeforeDiscountsCents = Math.round(priceDetails.totalPerClean * 100);

  if (priceBeforeDiscountsCents <= 0) {
    return {
      ok: false,
      error:
        "We could not calculate a price for this property. Please check your property details and try again.",
    };
  }

  // Admin-configurable first-clean discount (task 1.9): applies to the prepaid
  // first clean only (this is the signup charge). 0% by default.
  const firstCleanDiscountPercent = await getFirstCleanDiscountPercent();

  return {
    ok: true,
    priceDetails,
    priceBeforeDiscountsCents,
    chargeBeforePromoCents: applyFirstCleanDiscount(
      priceBeforeDiscountsCents,
      firstCleanDiscountPercent
    ),
    firstCleanDiscountPercent,
  };
}

export async function createPaymentIntentForSignup(
  formData: SignupFormData
): Promise<{
  clientSecret?: string;
  amountInCents?: number;
  promoDiscountCents?: number;
  error?: string;
}> {
  const stripe = getStripe();
  if (!stripe) {
    return { error: SERVICE_UNAVAILABLE.stripe };
  }

  const db = getDbOrNull();
  if (!db) {
    return { error: SERVICE_UNAVAILABLE.database };
  }

  const normalizedFormData = normalizeSignupFormDataForPricing(formData);

  const quote = await quoteFirstCleanChargeCents(normalizedFormData);
  if (!quote.ok) {
    return { error: quote.error };
  }

  const {
    priceDetails: serverPriceDetails,
    priceBeforeDiscountsCents: serverAmountInCents,
    chargeBeforePromoCents: afterFirstCleanDiscountCents,
    firstCleanDiscountPercent,
  } = quote;

  // Promo code (task 1.8), applied last — on what is left after the term
  // discount and the first-clean discount. The client-sent code is only a
  // lookup key; validity, value and limits all come from the DB row.
  const submittedPromoCode =
    typeof normalizedFormData.promoCode === "string"
      ? normalizedFormData.promoCode.trim()
      : "";

  let promoDiscountCents = 0;
  let appliedPromoCode = "";

  if (submittedPromoCode) {
    const { evaluation } = await resolvePromoCodeForAmount(
      submittedPromoCode,
      afterFirstCleanDiscountCents,
      normalizedFormData.email ?? ""
    );

    if (!evaluation.valid) {
      // Fail loudly rather than quietly charging full price: a customer who
      // typed a code and got charged without it has a refund conversation.
      return {
        error: `${evaluation.message} Remove or correct the code to continue.`,
      };
    }

    promoDiscountCents = evaluation.discountCents;
    appliedPromoCode = evaluation.code;
  }

  const chargeAmountCents = afterFirstCleanDiscountCents - promoDiscountCents;

  // Re-enforce the 7-day first-clean buffer server-side (the client date picker
  // is not trusted). Compare calendar days in US Eastern (ops timezone).
  const firstCleanDate = normalizedFormData.firstCleanDate;
  if (!(firstCleanDate instanceof Date) || Number.isNaN(firstCleanDate.getTime())) {
    return { error: "Please select a valid first clean date." };
  }
  const earliestFirstClean = addDays(
    getStartOfTodayEastern(),
    FIRST_CLEAN_BUFFER_DAYS
  );
  if (firstCleanDate < earliestFirstClean) {
    return {
      error: `The first clean must be at least ${FIRST_CLEAN_BUFFER_DAYS} days out. Please choose a later date.`,
    };
  }

  // Re-validate the service area against the geocoded address rather than
  // trusting the client-sent `isAddressInServiceArea` boolean, which the client
  // can set to anything.
  //
  // Previously this ran as `if (coords && outside) reject`, so a null geocode
  // skipped the check entirely and the booking went through unvalidated —
  // including when the Google key is unset, which makes every lookup fail.
  //
  // An address Google resolves outside the area, or refuses to resolve at all,
  // is now rejected. A geocoder we simply cannot reach is NOT treated as the
  // customer's fault: the booking proceeds and the failure is logged loudly,
  // so our own outage cannot block every booking. That leaves a deliberate,
  // narrow hole — an out-of-area booking can still land while geocoding is
  // down — which is why the log is an error, not a warning.
  if (normalizedFormData.address) {
    const geocode = await geocodeAddressResult(normalizedFormData.address);

    if (
      geocode.status === "ok" &&
      !isPointInServiceArea(
        geocode.coordinates.latitude,
        geocode.coordinates.longitude
      )
    ) {
      return {
        error:
          "The selected address is outside our current service area. Please contact CleanNami if you believe this is an error.",
      };
    }

    if (geocode.status === "not_found") {
      return {
        error:
          "We could not verify that address. Please check it and try again, or contact CleanNami and we will help.",
      };
    }

    if (geocode.status === "unavailable") {
      console.error(
        `[create-payment-intent] service-area check skipped, geocoding unavailable (${geocode.reason}). Booking allowed WITHOUT service-area validation.`
      );
    }
  }

  let stripeCustomerId: string | null = null;

  if (normalizedFormData.email) {
    const existingCustomer = await db.query.customers.findFirst({
      where: eq(customers.email, normalizedFormData.email),
      columns: { stripeCustomerId: true },
    });

    if (existingCustomer?.stripeCustomerId) {
      stripeCustomerId = existingCustomer.stripeCustomerId;
    }
  }

  const stripeCustomer = await resolveStripeCustomer(
    stripe,
    normalizedFormData,
    stripeCustomerId
  );

  const metadata: Stripe.MetadataParam = {
    customer_name: normalizedFormData.name ?? "N/A",
    customer_email: normalizedFormData.email ?? "N/A",
    property_address: normalizedFormData.address ?? "N/A",
    property_details: `${normalizedFormData.bedrooms} bed, ${normalizedFormData.bathrooms} bath, ${normalizedFormData.sqft ?? "N/A"} sqft`,
    laundry_service: `${normalizedFormData.laundryService} (${normalizedFormData.laundryLoads ?? 0} loads)`,
    hot_tub_service: (normalizedFormData.hasHotTub && "has hot tub") || "",
    hot_tub_drain: (normalizedFormData.hotTubDrain && "drain hot tub") || "",
    hotTub_drain_cadence: normalizedFormData.hotTubDrainCadence || "",
    subscription_term: `${normalizedFormData.subscriptionMonths} month(s)`,
    subscription_discount:
      serverPriceDetails.discountRate > 0
        ? `${Math.round(serverPriceDetails.discountRate * 100)}% (-$${serverPriceDetails.discountAmount.toFixed(2)})`
        : "none",
    // Machine-readable breakdown of the two first-clean-only discounts. These
    // are written by us with the secret key, so they are trustworthy input to
    // the amount re-check in complete-onboarding.service.ts. Without them that
    // check compares the charged amount against the undiscounted price and
    // rejects every discounted booking after the customer has already paid.
    price_before_discounts_cents: String(serverAmountInCents),
    first_clean_discount_percent: String(firstCleanDiscountPercent),
    promo_code: appliedPromoCode,
    promo_discount_cents: String(promoDiscountCents),
  };

  const paymentIntent = await stripe.paymentIntents.create({
    amount: chargeAmountCents,
    currency: "usd",
    customer: stripeCustomer.id,
    automatic_payment_methods: {
      enabled: true,
    },
    setup_future_usage: "off_session",
    metadata,
  });

  if (!paymentIntent.client_secret) {
    return { error: "Could not initialize payment. Please contact support." };
  }

  return {
    clientSecret: paymentIntent.client_secret,
    amountInCents: chargeAmountCents,
    promoDiscountCents,
  };
}
