import "server-only";

import { randomUUID } from "crypto";
import { db } from "@/db";
import { customers, jobs, properties } from "@/db/schemas";
import { PricingService } from "@/lib/services/pricing.service";
import { buildJobStaffingUpdate } from "@/lib/pricing/apply-job-staffing";
import { loadHotTubTimeAdditions } from "@/lib/pricing/hot-tub-time";
import { getStripe } from "@/lib/stripe/get-stripe";
import { getStartOfTodayEastern } from "@/lib/time/eastern";
import { fromZonedTime } from "date-fns-tz";
import { addDays } from "date-fns";
import { and, eq } from "drizzle-orm";

const EASTERN_TZ = "America/New_York";
/** Sensible default lead time for a one-off so it can be staffed/assigned. */
const ONE_OFF_BUFFER_DAYS = 2;

export type BookOneOffInput = { propertyId: string; date: string };
export type BookOneOffResult =
  | { success: true; jobId: string; amountCents: number }
  | { success: false; error: string };

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
  const property = await db.query.properties.findFirst({
    where: and(
      eq(properties.id, input.propertyId),
      eq(properties.customerId, customerId)
    ),
  });
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
  // override honoured.
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
      success: false,
      error: "This property needs a custom quote — please contact CleanNami.",
    };
  }

  const amountCents = Math.round(priceDetails.totalPerClean * 100);
  if (amountCents < 50) {
    return { success: false, error: "Calculated price is too low to charge." };
  }

  const customer = await db.query.customers.findFirst({
    where: eq(customers.id, customerId),
    columns: { stripeCustomerId: true },
  });
  const stripe = getStripe();
  if (!stripe || !customer?.stripeCustomerId) {
    return { success: false, error: "Payment is not set up for your account." };
  }

  const paymentMethods = await stripe.paymentMethods.list({
    customer: customer.stripeCustomerId,
    type: "card",
  });
  const paymentMethodId = paymentMethods.data[0]?.id;
  if (!paymentMethodId) {
    return { success: false, error: "No saved card on file. Please contact support." };
  }

  let paymentIntentId: string;
  try {
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: "usd",
        customer: customer.stripeCustomerId,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
        metadata: { type: "one_off", propertyId: property.id, customerId },
      },
      // Same customer/property/date never double-charges on a retry.
      { idempotencyKey: `oneoff_${customerId}_${property.id}_${input.date}` }
    );
    if (paymentIntent.status !== "succeeded") {
      return { success: false, error: "Payment could not be completed." };
    }
    paymentIntentId = paymentIntent.id;
  } catch (err) {
    console.error("[bookOneOffClean] charge failed", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Payment failed.",
    };
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
      notes: `[System] One-off clean prepaid. PaymentIntent ${paymentIntentId}.`,
    })
    .returning({ id: jobs.id });

  return { success: true, jobId: job.id, amountCents };
}
