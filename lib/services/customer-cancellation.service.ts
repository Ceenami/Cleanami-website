import "server-only";

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
import { CLEANER_HOURLY_RATE } from "@/lib/pricing/staffing-logic";
import { sendCancellationEmail } from "@/lib/services/email.service";
import { appendJobNote } from "@/lib/jobs/job-notes";
import { and, eq, gt, inArray, ne } from "drizzle-orm";

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

async function loadJobContext(jobId: string) {
  return db.query.jobs.findFirst({
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

function cleanersToPay(assignments: { role: string; cleanerId: string; urgentBonus?: boolean | null }[]) {
  const primaries = assignments.filter((a) => a.role === "primary");
  if (primaries.length > 0) return primaries;
  return assignments.filter((a) => a.role !== "backup" && a.role !== "on-call");
}

async function createCleanerPayouts(
  jobId: string,
  expectedHours: string | null,
  assignments: { role: string; cleanerId: string; urgentBonus: boolean | null }[]
) {
  const payTargets = cleanersToPay(assignments);
  if (payTargets.length === 0) return 0;

  const hours = parseFloat(expectedHours || "0");
  const basePay = hours * CLEANER_HOURLY_RATE;

  // Insert sequentially; the production pooler cannot pipeline DB writes.
  for (const assignment of payTargets) {
    let total = basePay;
    let urgentBonus: string | null = null;
    if (assignment.urgentBonus) {
      urgentBonus = "10.00";
      total += 10;
    }
    await db.insert(payouts).values({
      jobId,
      cleanerId: assignment.cleanerId,
      amount: total.toFixed(2),
      urgentBonusAmount: urgentBonus,
      status: "pending",
    });
  }

  return payTargets.length;
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
  });
}

async function chargeCustomerForLateCancel(
  jobId: string,
  job: {
    paymentIntentId: string | null;
    paymentStatus: string | null;
    addonsSnapshot: unknown;
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
  subscriptionMonths: number
): Promise<boolean> {
  if (skipPayment || customerSkipsBilling({ skipPayment })) return false;

  const stripe = getStripe();
  if (!stripe) {
    throw new Error(SERVICE_UNAVAILABLE.stripe);
  }

  if (job.paymentStatus === "captured") {
    return true;
  }

  // A skip-payment sentinel is not a Stripe PaymentIntent.
  if (
    job.paymentStatus === "authorized" &&
    job.paymentIntentId &&
    !isSkippedPaymentIntent(job.paymentIntentId)
  ) {
    await stripe.paymentIntents.capture(job.paymentIntentId);
    await db
      .update(jobs)
      .set({ paymentStatus: "captured", updatedAt: new Date() })
      .where(eq(jobs.id, jobId));
    return true;
  }

  if (!stripeCustomerId) {
    return false;
  }

  const priceDetails = await pricingService.calculatePrice(
    buildRecurringPricingInput(
      property,
      // Apply the customer's subscription term to the late-cancel quote.
      subscriptionMonths
    ) as never
  );

  const amountInCents = Math.round(priceDetails.totalPerClean * 100);
  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountInCents,
    currency: "usd",
    customer: stripeCustomerId,
    capture_method: "automatic",
    confirm: true,
    off_session: true,
    metadata: { job_id: jobId, reason: "late_customer_cancel" },
  });

  await db
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
  customerId: string
): Promise<CancelJobResult> {
  const job = await loadJobContext(jobId);
  if (!job?.property) {
    throw new Error("Job not found");
  }

  if (job.property.customerId !== customerId) {
    throw new Error("Forbidden");
  }

  const eligibility = canCancelJob(job.subscription, job, job.cleaners);
  if (!eligibility.allowed) {
    throw new Error(eligibility.reason ?? "Cannot cancel this clean");
  }

  return finalizeJobCancellation(
    job,
    eligibility.late,
    "customer",
    // One-time jobs do not have a subscription discount to preserve.
    job.subscription?.durationMonths ?? 1
  );
}

export async function cancelJobAsAdmin(jobId: string): Promise<CancelJobResult> {
  const job = await loadJobContext(jobId);

  // One-time jobs do not have a subscription.
  if (!job) {
    throw new Error("Job not found");
  }

  const late = job.checkInTime
    ? job.cleaners.length > 0 &&
      new Date(job.checkInTime).getTime() - Date.now() < 24 * 60 * 60 * 1000
    : false;

  return finalizeJobCancellation(
    job,
    late,
    "admin",
    // Use a one-month term for subscription-less jobs.
    job.subscription?.durationMonths ?? 1
  );
}

async function finalizeJobCancellation(
  job: {
    id: string;
    expectedHours: string | null;
    paymentIntentId: string | null;
    paymentStatus: string | null;
    /** Read so the cancellation line can be APPENDED rather than clobber it. */
    notes: string | null;
    addonsSnapshot: unknown;
    cleaners: {
      role: string;
      cleanerId: string;
      urgentBonus: boolean | null;
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
  subscriptionMonths: number
): Promise<CancelJobResult> {
  const assignments = job.cleaners;
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
    if (!job.property) {
      throw new Error("Property not found for job");
    }
    customerCharged = await chargeCustomerForLateCancel(
      job.id,
      job,
      job.property,
      job.property.customer?.stripeCustomerId ?? null,
      job.property.customer?.skipPayment ?? false,
      subscriptionMonths
    );
    cleanerPaid =
      (await createCleanerPayouts(job.id, job.expectedHours, assignments)) > 0;
  } else {
    await voidCustomerCharge(job);
  }

  await db.delete(jobsToCleaners).where(eq(jobsToCleaners.jobId, job.id));

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

  await db
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

  // Notify the customer their clean was canceled (best-effort).
  if (job.property?.customer?.email) {
    try {
      await sendCancellationEmail({
        to: job.property.customer.email,
        name: job.property.customer.name,
        propertyAddress: job.property.address ?? "your property",
        detail: lateCancel
          ? "This was a late cancellation, so the assigned cleaner will still be paid."
          : refundedIntentId
            ? "Your payment for this clean has been refunded in full. It can take a few business days to appear on your statement."
            : "No charge applies for this on-time cancellation.",
      });
    } catch (err) {
      console.error("[cancellation] email failed:", err);
    }
  }

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
  customerId: string
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
      gt(jobs.checkInTime, new Date())
    ),
    with: {
      cleaners: true,
      property: { with: { customer: true } },
      subscription: true,
    },
  });

  let jobsCanceled = 0;
  for (const upcomingJob of upcomingJobs) {
    const jobEligibility = canCancelJob(subscription, upcomingJob, upcomingJob.cleaners);
    if (!jobEligibility.allowed) continue;

    await finalizeJobCancellation(
      upcomingJob,
      jobEligibility.late,
      "customer",
      subscription.durationMonths
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
  subscriptionId: string
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
      gt(jobs.checkInTime, new Date())
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
      upcomingJob.cleaners
    );
    // Admin can cancel regardless of the customer notice window; use the
    // late flag purely to decide whether the cleaner is still paid.
    await finalizeJobCancellation(
      upcomingJob,
      jobEligibility.late,
      "admin",
      subscription.durationMonths
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
  subscriptionId: string
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
      gt(jobs.checkInTime, new Date())
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
      subscription.durationMonths
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
  subscriptionId: string
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
  subscriptionId: string
): Promise<boolean> {
  const row = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.id, subscriptionId),
        eq(subscriptions.customerId, customerId)
      )
    )
    .limit(1);
  return row.length > 0;
}
