import "server-only";

import { PricingService } from "@/lib/services/pricing.service";
import { SignupFormData } from "@/lib/validations/bookng-modal";
import { normalizeSignupFormDataForPricing } from "@/lib/validations/bookng-modal/serialize-signup-form";
import { customers } from "@/db/schemas";
import { getDbOrNull } from "@/db";
import { eq } from "drizzle-orm";
import { getStripe } from "@/lib/stripe/get-stripe";
import { SERVICE_UNAVAILABLE } from "@/lib/env/messages";
import { geocodeAddress } from "@/lib/services/google-maps/geocoding";
import { isPointInServiceArea } from "@/lib/google-maps/serviceArea/index.ts";
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

export async function createPaymentIntentForSignup(
  formData: SignupFormData
): Promise<{
  clientSecret?: string;
  amountInCents?: number;
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
  const serverPriceDetails =
    await pricingService.calculatePrice(normalizedFormData);

  if (serverPriceDetails.isCustomQuote) {
    return {
      error:
        "Properties over 3,000 sq ft require a custom quote. Please book a setup call or contact CleanNami.",
    };
  }

  const serverAmountInCents = Math.round(serverPriceDetails.totalPerClean * 100);

  if (serverAmountInCents <= 0) {
    return {
      error:
        "We could not calculate a price for this property. Please check your property details and try again.",
    };
  }

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
  // trusting the client-sent `isAddressInServiceArea` boolean. Geocoding is a
  // Google call, so degrade gracefully (allow) if it fails transiently.
  if (normalizedFormData.address) {
    const coords = await geocodeAddress(normalizedFormData.address);
    if (coords && !isPointInServiceArea(coords.latitude, coords.longitude)) {
      return {
        error:
          "The selected address is outside our current service area. Please contact CleanNami if you believe this is an error.",
      };
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
  };

  const paymentIntent = await stripe.paymentIntents.create({
    amount: serverAmountInCents,
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
    amountInCents: serverAmountInCents,
  };
}
