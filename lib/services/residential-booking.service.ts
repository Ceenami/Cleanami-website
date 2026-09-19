import "server-only";

import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import Stripe from "stripe";

import { getDbOrNull } from "@/db";
import { customers, jobs, properties } from "@/db/schemas";
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

/**
 * Residential one-time booking.
 *
 * Ordering follows one-off.service.ts: everything that can fail runs before the
 * charge, so there is exactly one write after money moves.
 *
 * One money path only. Under 48 hours is refused outright — no hold, no
 * approval queue, nothing to expire.
 *
 * entryInstructions holds door and gate codes. It goes to the properties row
 * and nowhere else — never Stripe metadata, jobs.notes or addonsSnapshot.
 */

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

/**
 * Everything that decides whether this booking may be sold. No Stripe call, no
 * writes. Kept separate from createResidentialPaymentIntent so the refusal
 * paths can be tested without going through Stripe.
 */
export async function evaluateResidentialBooking(
  input: ResidentialFormData,
  now: Date = new Date()
): Promise<ResidentialQuote | ResidentialRefusal> {
  const form = normalizeResidentialFormData(input);

  // Domain rules before shape. The schema refines on both of these too, but zod
  // collapses a refinement into a generic parse error and we need the reason
  // code plus the earliest bookable date to offer the customer.
  //
  // Guarded on the inputs being usable so a half-filled form still gets proper
  // field errors from the parse below instead of an answer computed from zeroes.
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

    // Re-checked server-side: the form only hides windows that don't fit, and a
    // hidden control isn't an enforced one.
    if (!windowFitsOperatingDay(preWindow, preHours)) {
      return {
        ok: false,
        reason: "no_window",
        error: RESIDENTIAL_NO_WINDOW_MESSAGE,
      };
    }

    // 48 hours, Eastern, measured from the START of the arrival window — not
    // midnight of the chosen date, and not the browser clock. Runs before any
    // PaymentIntent exists, so a refused booking leaves no record at all.
    if (!meetsResidentialNotice(form.cleanDate, form.arrivalWindow, now)) {
      return {
        ok: false,
        reason: "notice",
        error: RESIDENTIAL_NOTICE_MESSAGE,
        earliestBookableDate: earliestBookableDate(preHours, now) ?? undefined,
      };
    }
  }

  // Shape, including the same two rules again as refinements, so a direct API
  // post that skipped the wizard can't get through.
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

  // These return null rather than an Invalid Date. `Invalid Date < earliest` is
  // false, so a malformed time would sail past a buffer check and only be
  // rejected by Postgres after the card was charged.
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

  // Priced from the server's own inputs. There is no field for a client-sent
  // amount, and this is the only number the intent is created from.
  const pricingInput = buildResidentialPricingInput({
    bedCount: data.bedrooms,
    bathCount: data.bathrooms,
    sqFt: data.sqft,
    petsAllowed: data.petsAllowed,
  });
  // calculatePrice is typed against the vacation-rental form, where laundryLoads
  // is `number | undefined`; we pass an explicit null. The engine reads both as
  // zero loads, so the cast covers a type difference, not a behaviour one.
  const priceDetails = await pricingService.calculatePrice(
    pricingInput as unknown as Parameters<
      typeof pricingService.calculatePrice
    >[0]
  );

  // Covers isCustomQuote, pricingUnavailable, and the staffing case where a home
  // prices fine but the table declines to give it a team size. Call it rather
  // than re-implementing the checks.
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

/**
 * Create the PaymentIntent for a residential booking, or refuse.
 *
 * Automatic capture — the customer is at checkout, so there is a moment to
 * charge at. Subscriptions authorize the night before via the pre-authorize
 * cron; residential never reaches it, because that cron inner-joins
 * subscriptions and a residential job has none.
 */
export async function createResidentialPaymentIntent(input: {
  formData: ResidentialFormData;
  /** The onboarding session token, which is what makes the charge idempotent. */
  sessionToken: string | null;
  now?: Date;
}): Promise<
  | {
      ok: true;
      clientSecret: string;
      amountInCents: number;
      priceDetails: PriceDetails;
    }
  | ResidentialRefusal
> {
  const now = input.now ?? new Date();

  // Every refusal runs before any Stripe object exists, so a refused booking
  // leaves nothing behind: no customer, no property, no PaymentIntent.
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

  // Re-checked against the geocoder; the client-sent isAddressInServiceArea flag
  // can say anything. Same branches as create-payment-intent.service.ts,
  // including the fail-open on `unavailable`: an outage on our side shouldn't
  // block every booking. That hole is deliberate, which is why it logs at error.
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

  // Written with the secret key so completion can verify against it — otherwise
  // a succeeded PaymentIntent id could be replayed with attacker-chosen form
  // data.
  //
  // No entry_method, entry_instructions or parking_instructions here, and they
  // must stay out. None of it affects the price, so there's nothing to verify
  // and everything to leak.
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
  };

  let paymentIntent: Stripe.PaymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: "usd",
        customer: stripeCustomer.id,
        automatic_payment_methods: { enabled: true },
        metadata,
      },
      // No customer or property row exists yet, so there is nothing for the
      // one-off path's key to reference. The session token plus the date is the
      // stable equivalent. Omitted with no session: a constant key would
      // collapse different customers' bookings onto one charge.
      input.sessionToken
        ? {
            idempotencyKey: `res_${input.sessionToken}_${form.cleanDate}_${amountCents}`,
          }
        : undefined
    );
  } catch (error) {
    console.error("[residential-booking] PaymentIntent create failed", error);
    if ((error as { code?: string } | null)?.code === "idempotency_error") {
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
    amountInCents: amountCents,
    priceDetails,
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

/**
 * Coordinates in the shape the property columns want. Runs after the card is
 * charged, so it returns null rather than throwing — a geocode problem must not
 * fail a paid booking.
 */
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

/**
 * Finalise a paid residential booking: verify the PaymentIntent really belongs
 * to this booking, then write the customer, the property and the job.
 *
 * The verification block is not optional: without it, someone else's succeeded
 * PaymentIntent id could be replayed to mint a property bound to attacker-chosen
 * form data. Email, address and amount are all compared against metadata we
 * wrote with the secret key, and the amount against a fresh server re-price.
 *
 * Unlike the one-off path, we cannot put the fallible work before the charge —
 * the Payment Element already confirmed it by the time the browser calls us. So
 * instead:
 *
 * - everything fallible that doesn't write runs before the first write;
 * - the three writes are one transaction, so we never leave a property with no
 *   job or a job with no property;
 * - if that transaction fails, voidCharge() refunds. A phantom charge is visible
 *   in Stripe; a phantom unpaid job would be assigned and paid out as prepaid.
 *
 * The job keeps its payment_intent_id because capture-and-payout returns early
 * for a job without one, before the reserve_transactions insert — so a job with
 * no intent id accrues no 2% reserve at all.
 */
export async function completeResidentialBooking(
  formData: ResidentialFormData,
  paymentIntentId: string
): Promise<CompleteResidentialResult> {
  // Set only once every tamper check has passed. Tells the catch block whether
  // an unexpected failure is ours to refund.
  let paymentVerified = false;

  try {
    const stripe = getStripe();
    if (!stripe) return { success: false, error: SERVICE_UNAVAILABLE.stripe };

    const db = getDbOrNull();
    if (!db) return { success: false, error: SERVICE_UNAVAILABLE.database };

    // Re-runs every refusal, so a booking cannot be completed against a form
    // that would be refused if submitted fresh.
    const quote = await evaluateResidentialBooking(formData);
    if (!quote.ok) return { success: false, error: quote.error };

    const { form, amountCents } = quote;

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

    // The server re-price wins. Nothing discounts a residential booking yet, so
    // the charge and the price are the same number and any gap is tampering.
    if (paymentIntent.amount !== amountCents) {
      return {
        success: false,
        error:
          "The payment amount does not match the expected price for this booking. Please contact support.",
      };
    }

    // From here on a failure is ours, and the catch block refunds.
    paymentVerified = true;

    // Replay guard keyed on the PaymentIntent. Not on (customer, address): a
    // repeat customer booking a second clean at the same home is not a replay,
    // and matching the address there would take their money and hand back the
    // first booking's ids without creating the job they paid for.
    const replayed = await db.query.jobs.findFirst({
      where: eq(jobs.paymentIntentId, paymentIntentId),
      columns: { id: true, propertyId: true },
      with: { property: { columns: { customerId: true } } },
    });

    if (replayed?.propertyId && replayed.property?.customerId) {
      const invite = await inviteCustomerToPortalAfterPayment({
        email: form.email!,
        name: form.name ?? "",
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

    const coordinates = await geocodeForProperty(form.address!);

    // Easy to get backwards: default_check_out_time is the arrival anchor (the
    // column the early-check-in gate reads) and default_check_in_time is the
    // must-finish-before. On a rental those names mean guest check-out and
    // check-in; on a home they are the same two roles under different words, and
    // each surface picks its wording from service_type.
    const windowStartTime = minutesToTimeOfDay(quote.window.startMinutes);
    const mustFinishBeforeTime = minutesToTimeOfDay(
      mustFinishBeforeMinutes(quote.window, quote.expectedHours)
    );

    // Staffed before the first write, so a failure here has no half-written
    // booking to undo.
    //
    // buildJobStaffingUpdate wants a subscriptionStart and there is no
    // subscription. The arrival instant is safe to pass: it only reaches
    // isHotTubDeepCleanDue, and only when hotTubServiceLevel is true, which
    // residential never sets.
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
      // Display only. The real bounds are check_in_time and check_out_time;
      // this is so a cleaner surface can say "arrive between 9:00 and 11:00"
      // instead of inferring a window from the two timestamps.
      arrivalWindow: quote.window.key,
    };

    // The snapshot is read by the native app and travels across surfaces that
    // have no business holding a door code. buildJobStaffingUpdate spreads
    // existingSnapshot, so a future caller could put one here by accident — one
    // loop turns a silent credential leak into a refund.
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
        // Fixed, not asked. Residential offers neither, and laundry_type
        // 'none' is what makes getTeamSize return the in-unit column.
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
        // This row is the ONLY place the codes live.
        entryMethod: form.entryMethod ?? null,
        entryInstructions: form.entryInstructions ?? null,
        parkingInstructions: form.parkingInstructions ?? null,
        // The residential form has always collected this and, until M7, always
        // discarded it — the customer typed a note about their home and it
        // reached nobody. It is not a credential (see the column comment), so
        // it renders to the cleaner beside the access details rather than
        // inside them.
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

      // No subscription: the job reaches its customer through the property. The
      // synthetic UID can't collide with a feed UID, so cancellation detection
      // never sees it and can't delete the job.
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
          // No access data here — jobs.notes renders on more surfaces than the
          // job detail view.
          notes: `[System] Residential one-time clean, prepaid. PaymentIntent ${paymentIntentId}.`,
        })
        .returning({ id: jobs.id });

      // Otherwise this surfaces as "cannot read properties of undefined"
      // further down, after the money moved.
      if (!job) throw new Error("jobs insert returned no rows");

      return { customer, property, job };
    });

    // How the customer sees the clean they just paid for.
    const accountResult = await inviteCustomerToPortalAfterPayment({
      email: form.email!,
      name: form.name!,
    });

    // In-app only. The email flag is for time-sensitive alerts and this isn't
    // one: the clean is at least 48h out, the job is already visible in
    // job-oversight, and the assignment engine will try to staff it before
    // anyone needs to act. The engine *failing* is what escalates by email.
    //
    // booking_alert needs migration 0042, but notifyAdmins swallows its own
    // errors, so an unapplied 0042 costs the bell and not the booking.
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

    // Last, and best-effort: the clean is booked and paid for by now, and Resend
    // being down must not turn that into a refund. Carries the access reminder —
    // the method, never the code — and the cancellation/refund wording.
    try {
      await sendResidentialBookingConfirmationEmail({
        to: form.email!,
        name: form.name,
        propertyAddress: form.address!,
        cleanDate: form.cleanDate!,
        arrivalWindowLabel: quote.window.label,
        amount: formatUsd(amountCents),
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

    // Payment verified, so this is our failure: the card was charged for a
    // booking that doesn't exist, and we refund rather than strand it.
    //
    // The tamper checks above return rather than throw, so they never land here.
    // A mismatched email or amount must not auto-refund a PaymentIntent that may
    // not belong to the submitter at all.
    if (paymentVerified) {
      await voidCharge({
        paymentIntentId,
        // Confirmed by the Payment Element with automatic capture, so it is
        // already succeeded. There is no job row to read a status from.
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
