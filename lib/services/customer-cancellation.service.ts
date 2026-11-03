import "server-only";
import { getExecutionContract } from "./job-execution-contract";
import { cancelExecutionJob } from "./payment/execution-cancellation";

import { db } from "@/db";
import {
  customers,
  jobs,
  jobsToCleaners,
  payouts,
  properties,
  subscriptions,
} from "@/db/schemas";
import {
  canCancelJob,
  canCancelSubscription,
  isLateCancellation,
} from "@/lib/cancellation/rules";
import { SERVICE_UNAVAILABLE } from "@/lib/env/messages";
import {
  customerSkipsBilling,
  isSkippedPaymentIntent,
} from "@/lib/billing/customer-billing";
import { buildRecurringPricingInput } from "@/lib/pricing/recurring-pricing-input";
import { PricingService } from "@/lib/services/pricing.service";
import { getStripe } from "@/lib/stripe/get-stripe";
import { voidCharge } from "@/lib/services/payment/void-charge";
import { computeCleanerPay } from "@/lib/pricing/cleaner-pay";
import { readResidentialSnapshot } from "@/lib/pricing/residential-v2/contracts";
import { sendCancellationEmail } from "@/lib/services/email.service";
import { appendJobNote } from "@/lib/jobs/job-notes";
import { verifySettledPayment } from "./payment/verify-settled-payment";
import { authorizeRentalCharge } from "./payment/rental-authorization";
import { freezeRentalCharge } from "./payment/freeze-rental-charge";
import { buildRentalCharge, readRentalCharge, rentalJobPricingInput, RentalPricingError } from "@/lib/pricing/rental-charge";
import { rentalQuoteRefusal } from "@/lib/pricing/rental-quote-refusal";
import { resolvePromoCodeById, recordPromoRedemption } from "./promo-code.service";
import { and, eq, gt, inArray, ne } from "drizzle-orm";

type CancellationWriter =
  typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

const pricingService = new PricingService();
const CANCELABLE_STATUSES = ["unassigned", "assigned"] as const;

export type CancelJobResult = {
  jobId: string;
  lateCancel: boolean;
  cleanersReleased: number;
  customerCharged: boolean;
  cleanerPaid: boolean;
  message: string;
};

export type CancelSubscriptionResult = {
  subscriptionId: string;
  jobsCanceled: number;
  message: string;
};

async function loadJobContext(jobId: string, reader: CancellationWriter = db) {
  return reader.query.jobs.findFirst({
    where: eq(jobs.id, jobId),
    with: {
      cleaners: true,
      property: {
        with: { customer: true },
      },
      subscription: true,
    },
  });
}

type PayAssignment = {
  role: string;
  cleanerId: string;
  urgentBonus: boolean | null;
  frozenHourlyRateCents?: number | null;
  residentialPayTerms?: unknown;
};

async function createCleanerPayouts(
  jobId: string,
  expectedHours: string | null,
  assignments: PayAssignment[],
  writer: CancellationWriter = db,
  laundryLoads = 0,
  residentialPricing?: unknown,
) {
  const workers = assignments.filter((a) =>
    ["primary", "laundry_lead"].includes(a.role),
  );
  for (const assignment of workers) {
    const pay = computeCleanerPay({
      residentialPricing,
      assignmentTerms: assignment.residentialPayTerms,
      settlement: "late_cancellation",
      expectedHours: Number(expectedHours ?? 0),
      hourlyRateCents: assignment.frozenHourlyRateCents,
      role: assignment.role,
      laundryLoads,
      urgentBonus: assignment.urgentBonus,
    });
    await writer
      .insert(payouts)
      .values({
        jobId,
        cleanerId: assignment.cleanerId,
        amount: pay.total.toFixed(2),
        payReceipt: pay.receipt ?? null,
        urgentBonusAmount: pay.urgentBonus ? pay.urgentBonus.toFixed(2) : null,
        laundryBonusAmount: pay.laundryBonus
          ? pay.laundryBonus.toFixed(2)
          : null,
        status: "pending",
      })
      .onConflictDoNothing({ target: [payouts.jobId, payouts.cleanerId] });
  }
  return workers.length;
}

async function voidCustomerCharge(job: {
  paymentIntentId: string | null;
  paymentStatus: string | null;
}) {
  // Shared refund helper for cancellation and booking recovery.
  await voidCharge({
    paymentIntentId: job.paymentIntentId,
    paymentStatus: job.paymentStatus,
    context: "cancelJob",
    strict: true,
  });
}

async function chargeCustomerForLateCancel(
  jobId: string,
  job: {
    paymentIntentId: string | null;
    paymentStatus: string | null;
    addonsSnapshot: unknown;
    jobSource?: string | null;
    serviceType?: string | null;
    rentalCharge?: unknown;
  },
  property: {
    bedCount: number;
    bathCount: string | number;
    sqFt: number | null;
    laundryType: string;
    laundryLoads: number | null;
    hasHotTub: boolean;
    hotTubServiceLevel: boolean;
    hotTubDrain: boolean;
    hotTubDrainCadence: string | null;
    /** a late-cancel charge must match what the clean would have cost. */
    petsAllowed: boolean;
    priceOverrideCents?: number | null;
  },
  stripeCustomerId: string | null,
  skipPayment: boolean,
  subscriptionMonths: number,
  writer: CancellationWriter = db,
): Promise<boolean> {
  if (
    skipPayment ||
    customerSkipsBilling({ skipPayment }) ||
    isSkippedPaymentIntent(job.paymentIntentId) ||
    (job.jobSource === "manual" && !job.paymentIntentId)
  )
    return false;

  const stripe = getStripe();
  if (!stripe) {
    throw new Error(SERVICE_UNAVAILABLE.stripe);
  }

  const residential = readResidentialSnapshot(job.addonsSnapshot);
  if (residential.kind === "v2") {
    // Residential is prepaid. Never reconstruct a cancellation price from rental tables.
    if (!job.paymentIntentId) throw new Error("Residential cancellation payment needs review");
    let intent = await stripe.paymentIntents.retrieve(job.paymentIntentId);
    if (intent.status === "requires_capture")
      intent = await stripe.paymentIntents.capture(job.paymentIntentId, {}, {
        idempotencyKey: `late_cancel_capture_${jobId}`,
      });
    await verifySettledPayment(stripe, intent, residential.terms.amountChargedCents);
    await writer.update(jobs).set({ paymentStatus: "captured", updatedAt: new Date() }).where(eq(jobs.id, jobId));
    return true;
  }

  const rental = job.serviceType === "vacation_rental_subscription";
  const frozen = rental ? readRentalCharge(job.rentalCharge) : null;
  if (frozen?.skippedPayment) return false;
  if (job.paymentIntentId) {
    // Local captured/authorized flags are not proof of current provider truth.
    let intent = await stripe.paymentIntents.retrieve(job.paymentIntentId);
    const expected = frozen?.chargeAmountCents ?? intent.amount;
    if (intent.amount !== expected || intent.currency !== "usd")
      throw new RentalPricingError("Cancellation payment differs from its frozen charge; billing review is required");
    if (intent.status === "requires_capture")
      intent = await stripe.paymentIntents.capture(job.paymentIntentId, {}, {
        idempotencyKey: `late_cancel_capture_${jobId}`,
      });
    await verifySettledPayment(stripe, intent, expected);
    await writer.update(jobs).set({ paymentStatus: "captured", updatedAt: new Date() })
      .where(eq(jobs.id, jobId));
    return true;
  }

  if (!stripeCustomerId) throw new Error("Cancellation billing needs a saved Stripe customer");
  if (rental) {
    if (!frozen) throw new RentalPricingError("Cancellation requires a recorded rental charge before payment");
    // The caller holds the job lock. Cron uses the same lock, key and manual
    // authorization parameters, so uncertain preauthorization cannot double bill.
    let intent = await authorizeRentalCharge(stripe, jobId, stripeCustomerId, frozen);
    if (intent.status === "requires_capture")
      intent = await stripe.paymentIntents.capture(intent.id, {}, {
        idempotencyKey: `late_cancel_capture_${jobId}`,
      });
    await verifySettledPayment(stripe, intent, frozen.chargeAmountCents);
    await writer.update(jobs).set({ paymentIntentId: intent.id, paymentStatus: "captured", updatedAt: new Date() })
      .where(eq(jobs.id, jobId));
    return true;
  }

  const priceDetails = await pricingService.calculatePrice(
    buildRecurringPricingInput(
      property,
      // Apply the customer's subscription term to the late-cancel quote.
      subscriptionMonths,
    ) as never,
  );

  const amountInCents = Math.round(priceDetails.totalPerClean * 100);
  const paymentIntent = await stripe.paymentIntents.create(
    {
      amount: amountInCents,
      currency: "usd",
      customer: stripeCustomerId,
      capture_method: "automatic",
      confirm: true,
      off_session: true,
      metadata: { job_id: jobId, reason: "late_customer_cancel" },
    },
    { idempotencyKey: `late_cancel_${jobId}` },
  );

  await verifySettledPayment(stripe, paymentIntent, amountInCents);

  await writer
    .update(jobs)
    .set({
      paymentIntentId: paymentIntent.id,
      paymentStatus: "captured",
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, jobId));

  return paymentIntent.status === "succeeded";
}

export async function cancelJobForCustomer(
  jobId: string,
  customerId: string,
): Promise<CancelJobResult> {
  const job = await loadJobContext(jobId);
  if (!job?.property) {
    throw new Error("Job not found");
  }

  if (job.property.customerId !== customerId) {
    throw new Error("Forbidden");
  }

  const issuedExecution = await getExecutionContract(jobId);
  if (issuedExecution && job.status === "canceled") return cancelExecutionJob(jobId, "customer");
  if (job.status === "canceled") return alreadyCanceled(job.id);
  const eligibility = canCancelJob(job.subscription, job, job.cleaners);
  if (!eligibility.allowed) {
    throw new Error(eligibility.reason ?? "Cannot cancel this clean");
  }

  if (issuedExecution) return cancelExecutionJob(jobId, "customer");
  return finalizeJobCancellation(
    job,
    eligibility.late,
    "customer",
    // One-time jobs do not have a subscription discount to preserve.
    job.subscription?.durationMonths ?? 1,
  );
}

export async function cancelJobAsAdmin(jobId: string): Promise<CancelJobResult> {
  if (await getExecutionContract(jobId)) return cancelExecutionJob(jobId, "admin");
  const job = await loadJobContext(jobId);

  // One-time jobs do not have a subscription.
  if (!job) {
    throw new Error("Job not found");
  }

  const late = job.checkInTime
    ? isLateCancellation(job.checkInTime, job.cleaners)
    : false;

  return finalizeJobCancellation(
    job,
    late,
    "admin",
    // Use a one-month term for subscription-less jobs.
    job.subscription?.durationMonths ?? 1,
  );
}

function alreadyCanceled(jobId: string): CancelJobResult {
  return {
    jobId,
    lateCancel: false,
    cleanersReleased: 0,
    customerCharged: false,
    cleanerPaid: false,
    message: "This clean is already canceled.",
  };
}

async function finalizeJobCancellation(
  job: Parameters<typeof performJobCancellation>[0],
  lateCancel: boolean,
  source: "customer" | "admin",
  subscriptionMonths: number,
): Promise<CancelJobResult> {
  let dispatched = false;
  if (await getExecutionContract(job.id)) return cancelExecutionJob(job.id, source);
  // Persist outside the cancellation transaction. An ambiguous provider result
  // must not roll back the charge basis and reprice a later retry.
  if (lateCancel && job.serviceType === "vacation_rental_subscription" &&
      !job.paymentIntentId && !readRentalCharge(job.rentalCharge) && job.property &&
      !job.property.customer?.skipPayment && job.jobSource !== "manual") {
    const input = rentalJobPricingInput(job.property, subscriptionMonths,
      job.addonsSnapshot as Parameters<typeof rentalJobPricingInput>[2]);
    const price = await pricingService.calculatePrice(input);
    const refusal = rentalQuoteRefusal(price, input);
    if (refusal) throw new RentalPricingError(refusal);
    const candidate = buildRentalCharge(price, job.addonsSnapshot as Parameters<typeof buildRentalCharge>[1], false);
    if (job.promoCodeId) {
      const { evaluation } = await resolvePromoCodeById(job.promoCodeId,
        candidate.amountCents, job.property.customer?.email ?? "");
      if (evaluation.valid) {
        candidate.chargeAmountCents = evaluation.finalAmountCents;
        candidate.promo = { promoCodeId: job.promoCodeId, code: evaluation.code,
          discountAmountCents: evaluation.discountCents };
      }
    }
    await freezeRentalCharge(db, job.id, candidate, job.promoCodeId ?? null);
  }
  const result = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: jobs.status })
      .from(jobs)
      .where(eq(jobs.id, job.id))
      .for("update");
    if (!current) throw new Error("Job not found");
    if (current.status === "canceled") return alreadyCanceled(job.id);
    if (!["assigned", "unassigned"].includes(current.status ?? ""))
      throw new Error("This clean cannot be canceled in its current state");
    const locked = await loadJobContext(job.id, tx);
    if (!locked) throw new Error("Job not found");
    const canceled = await performJobCancellation(
      locked,
      lateCancel,
      source,
      subscriptionMonths,
      tx,
    );
    dispatched = true;
    return canceled;
  });
  if (dispatched && result.customerCharged && job.serviceType === "vacation_rental_subscription") {
    // Redemption bookkeeping runs after the job transaction; no nested pooler
    // transaction while its row lock is held. It is idempotent on PaymentIntent.
    try {
      const saved = await loadJobContext(job.id);
      const charge = readRentalCharge(saved?.rentalCharge);
      if (saved?.paymentIntentId && charge?.promo)
        await recordPromoRedemption({ ...charge.promo, customerEmail: saved.property?.customer?.email ?? "",
          customerId: saved.property?.customerId, subscriptionId: saved.subscriptionId,
          jobId: saved.id, paymentIntentId: saved.paymentIntentId,
          originalAmountCents: charge.amountCents, finalAmountCents: charge.chargeAmountCents });
    } catch (error) { console.error("[cancellation] promo bookkeeping failed:", error); }
  }
  // Only notify after all job/assignment/payout writes have committed.
  if (dispatched && job.property?.customer?.email) {
    try {
      await sendCancellationEmail({
        to: job.property.customer.email,
        name: job.property.customer.name,
        propertyAddress: job.property.address ?? "your property",
        detail: result.message,
      });
    } catch (error) {
      console.error("[cancellation] email failed:", error);
    }
  }
  return result;
}

async function performJobCancellation(
  job: {
    id: string;
    expectedHours: string | null;
    paymentIntentId: string | null;
    paymentStatus: string | null;
    /** Read so the cancellation line can be APPENDED rather than clobber it. */
    notes: string | null;
    addonsSnapshot: unknown;
    jobSource?: string | null;
    serviceType?: string | null;
    rentalCharge?: unknown;
    promoCodeId?: string | null;
    cleaners: {
      role: string;
      cleanerId: string;
      urgentBonus: boolean | null;
      frozenHourlyRateCents?: number | null;
      residentialPayTerms?: unknown;
    }[];
    property: {
      bedCount: number;
      bathCount: string | number;
      sqFt: number | null;
      laundryType: string;
      laundryLoads: number | null;
      hasHotTub: boolean;
      hotTubServiceLevel: boolean;
      hotTubDrain: boolean;
      hotTubDrainCadence: string | null;
      petsAllowed: boolean;
      priceOverrideCents?: number | null;
      address?: string;
      customer: {
        stripeCustomerId: string | null;
        skipPayment: boolean;
        email?: string;
        name?: string;
      } | null;
    } | null;
  },
  lateCancel: boolean,
  source: "customer" | "admin",
  subscriptionMonths: number,
  writer: CancellationWriter,
): Promise<CancelJobResult> {
  const assignments = job.cleaners;
  // Reject explicit corrupt contracts before any refund, charge or pay write.
  const contract = readResidentialSnapshot(job.addonsSnapshot);
  // Admin/business cancellation must not levy a customer late-cancellation charge.
  if (source === "admin" && contract.kind === "v2" && contract.terms.executionPolicy)
    lateCancel = false;
  let customerCharged = false;
  let cleanerPaid = false;

  // Captured prepaid jobs are refunded on an on-time cancellation.
  const refundedIntentId =
    !lateCancel &&
    job.paymentStatus === "captured" &&
    job.paymentIntentId &&
    !isSkippedPaymentIntent(job.paymentIntentId)
      ? job.paymentIntentId
      : null;

  if (lateCancel) {
    if (contract.kind === "v2") {
      // Validate every frozen worker contract before any financial operation.
      for (const assignment of assignments.filter(a => ["primary", "laundry_lead"].includes(a.role)))
        computeCleanerPay({
          residentialPricing: contract.terms, assignmentTerms: assignment.residentialPayTerms,
          settlement: "late_cancellation", expectedHours: Number(job.expectedHours ?? 0),
          hourlyRateCents: assignment.frozenHourlyRateCents, role: assignment.role,
          urgentBonus: assignment.urgentBonus,
        });
    }
    if (!job.property) {
      throw new Error("Property not found for job");
    }
    customerCharged = await chargeCustomerForLateCancel(
      job.id,
      job,
      job.property,
      job.property.customer?.stripeCustomerId ?? null,
      job.property.customer?.skipPayment ?? false,
      subscriptionMonths,
      writer,
    );
    cleanerPaid =
      (await createCleanerPayouts(
        job.id,
        job.expectedHours,
        assignments,
        writer,
        (job.addonsSnapshot as { laundryLoads?: number } | null)
          ?.laundryLoads ?? 0,
        (job.addonsSnapshot as { residentialPricing?: unknown } | null)
          ?.residentialPricing,
      )) > 0;
  } else {
    await voidCustomerCharge(job);
  }

  await writer.delete(jobsToCleaners).where(eq(jobsToCleaners.jobId, job.id));

  const notePrefix = lateCancel
    ? `[Late cancel – cleaner paid]`
    : refundedIntentId
      ? `[On-time cancel – refunded]`
      : `[On-time cancel – no charge]`;

  const noteLine = refundedIntentId
    ? `${notePrefix} Canceled by ${source} at ${new Date().toISOString()}. Refunded PaymentIntent ${refundedIntentId}.`
    : `${notePrefix} Canceled by ${source} at ${new Date().toISOString()}`;

  // Preserve a prior refund when a cancellation request is retried.
  const alreadyRefunded = job.paymentStatus === "refunded";

  await writer
    .update(jobs)
    .set({
      status: "canceled",
      notes: appendJobNote(job.notes, noteLine),
      updatedAt: new Date(),
      // Keep the PaymentIntent for reconciliation and Stripe webhook lookups.
      ...(lateCancel
        ? {}
        : {
            paymentStatus:
              refundedIntentId || alreadyRefunded ? "refunded" : null,
          }),
    })
    .where(eq(jobs.id, job.id));

  return {
    jobId: job.id,
    lateCancel,
    cleanersReleased: assignments.length,
    customerCharged,
    cleanerPaid,
    message: lateCancel
      ? "Clean canceled. Your assigned cleaner will still be paid for this late cancellation."
      : refundedIntentId
        ? "Clean canceled and the prepaid charge refunded in full. No cleaner pay for this job."
        : "Clean canceled. No charge and no cleaner pay for this job.",
  };
}

export async function cancelSubscriptionForCustomer(
  subscriptionId: string,
  customerId: string,
): Promise<CancelSubscriptionResult> {
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.id, subscriptionId),
    with: { property: true },
  });

  if (!subscription) {
    throw new Error("Subscription not found");
  }

  if (subscription.customerId !== customerId) {
    throw new Error("Forbidden");
  }

  const eligibility = canCancelSubscription(subscription);
  if (!eligibility.allowed) {
    throw new Error(eligibility.reason ?? "Cannot cancel subscription");
  }

  const upcomingJobs = await db.query.jobs.findMany({
    where: and(
      eq(jobs.subscriptionId, subscriptionId),
      inArray(jobs.status, [...CANCELABLE_STATUSES]),
      gt(jobs.checkInTime, new Date()),
    ),
    with: {
      cleaners: true,
      property: { with: { customer: true } },
      subscription: true,
    },
  });

  let jobsCanceled = 0;
  for (const upcomingJob of upcomingJobs) {
    const jobEligibility = canCancelJob(
      subscription,
      upcomingJob,
      upcomingJob.cleaners,
    );
    if (!jobEligibility.allowed) continue;

    await finalizeJobCancellation(
      upcomingJob,
      jobEligibility.late,
      "customer",
      subscription.durationMonths,
    );
    jobsCanceled += 1;
  }

  await db
    .update(subscriptions)
    .set({ status: "canceled", updatedAt: new Date() })
    .where(eq(subscriptions.id, subscriptionId));

  return {
    subscriptionId,
    jobsCanceled,
    message:
      jobsCanceled > 0
        ? `Subscription canceled. ${jobsCanceled} upcoming clean(s) were canceled.`
        : "Subscription canceled. No upcoming cleans were scheduled.",
  };
}

/**
 * Admin cancel: cancels upcoming cleans then marks the subscription canceled.
 * Unlike the customer path this does not enforce the minimum-term rule.
 */
export async function cancelSubscriptionAsAdmin(
  subscriptionId: string,
): Promise<CancelSubscriptionResult> {
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.id, subscriptionId),
    with: { property: true },
  });

  if (!subscription) {
    throw new Error("Subscription not found");
  }

  const upcomingJobs = await db.query.jobs.findMany({
    where: and(
      eq(jobs.subscriptionId, subscriptionId),
      inArray(jobs.status, [...CANCELABLE_STATUSES]),
      gt(jobs.checkInTime, new Date()),
    ),
    with: {
      cleaners: true,
      property: { with: { customer: true } },
      subscription: true,
    },
  });

  let jobsCanceled = 0;
  for (const upcomingJob of upcomingJobs) {
    const jobEligibility = canCancelJob(
      subscription,
      upcomingJob,
      upcomingJob.cleaners,
    );
    // Admin can cancel regardless of the customer notice window; use the
    // late flag purely to decide whether the cleaner is still paid.
    await finalizeJobCancellation(
      upcomingJob,
      jobEligibility.late,
      "admin",
      subscription.durationMonths,
    );
    jobsCanceled += 1;
  }

  await db
    .update(subscriptions)
    .set({ status: "canceled", updatedAt: new Date() })
    .where(eq(subscriptions.id, subscriptionId));

  return {
    subscriptionId,
    jobsCanceled,
    message:
      jobsCanceled > 0
        ? `Subscription canceled. ${jobsCanceled} upcoming clean(s) were canceled.`
        : "Subscription canceled. No upcoming cleans were scheduled.",
  };
}

export type SetSubscriptionStatusResult = {
  subscriptionId: string;
  status: "active" | "paused";
  jobsAffected: number;
  message: string;
};

/**
 * Admin pause: mark paused and release upcoming unassigned/assigned cleans so
 * no new work is dispatched while paused. On-time (no cleaner charge).
 */
export async function pauseSubscriptionAsAdmin(
  subscriptionId: string,
): Promise<SetSubscriptionStatusResult> {
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.id, subscriptionId),
  });
  if (!subscription) {
    throw new Error("Subscription not found");
  }
  if (subscription.status === "canceled" || subscription.status === "expired") {
    throw new Error("Cannot pause a canceled or expired subscription");
  }

  const upcomingJobs = await db.query.jobs.findMany({
    where: and(
      eq(jobs.subscriptionId, subscriptionId),
      inArray(jobs.status, [...CANCELABLE_STATUSES]),
      gt(jobs.checkInTime, new Date()),
    ),
    with: {
      cleaners: true,
      property: { with: { customer: true } },
      subscription: true,
    },
  });

  let jobsAffected = 0;
  for (const upcomingJob of upcomingJobs) {
    // Pause releases scheduled cleans as on-time cancellations (no charge).
    await finalizeJobCancellation(
      upcomingJob,
      false,
      "admin",
      subscription.durationMonths,
    );
    jobsAffected += 1;
  }

  await db
    .update(subscriptions)
    .set({ status: "paused", updatedAt: new Date() })
    .where(eq(subscriptions.id, subscriptionId));

  return {
    subscriptionId,
    status: "paused",
    jobsAffected,
    message:
      jobsAffected > 0
        ? `Subscription paused. ${jobsAffected} upcoming clean(s) were released.`
        : "Subscription paused.",
  };
}

/** Admin resume: flip a paused subscription back to active. */
export async function resumeSubscriptionAsAdmin(
  subscriptionId: string,
): Promise<SetSubscriptionStatusResult> {
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.id, subscriptionId),
  });
  if (!subscription) {
    throw new Error("Subscription not found");
  }
  if (subscription.status !== "paused") {
    throw new Error("Only a paused subscription can be resumed");
  }

  await db
    .update(subscriptions)
    .set({ status: "active", updatedAt: new Date() })
    .where(eq(subscriptions.id, subscriptionId));

  return {
    subscriptionId,
    status: "active",
    jobsAffected: 0,
    message: "Subscription resumed.",
  };
}

export async function customerOwnsSubscription(
  customerId: string,
  subscriptionId: string,
): Promise<boolean> {
  const row = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.id, subscriptionId),
        eq(subscriptions.customerId, customerId),
      ),
    )
    .limit(1);
  return row.length > 0;
}
