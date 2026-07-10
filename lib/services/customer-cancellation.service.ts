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
import { customerSkipsBilling } from "@/lib/billing/customer-billing";
import { PricingService } from "@/lib/services/pricing.service";
import { getStripe } from "@/lib/stripe/get-stripe";
import { CLEANER_HOURLY_RATE } from "@/lib/pricing/staffing-logic";
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

  await Promise.all(
    payTargets.map((assignment) => {
      let total = basePay;
      let urgentBonus: string | null = null;
      if (assignment.urgentBonus) {
        urgentBonus = "10.00";
        total += 10;
      }
      return db.insert(payouts).values({
        jobId,
        cleanerId: assignment.cleanerId,
        amount: total.toFixed(2),
        urgentBonusAmount: urgentBonus,
        status: "pending",
      });
    })
  );

  return payTargets.length;
}

async function voidCustomerCharge(job: {
  paymentIntentId: string | null;
  paymentStatus: string | null;
}) {
  const stripe = getStripe();
  if (!stripe || !job.paymentIntentId || job.paymentIntentId === "skipped_owner_payment") {
    return;
  }

  if (job.paymentStatus === "authorized") {
    try {
      await stripe.paymentIntents.cancel(job.paymentIntentId);
    } catch (error) {
      console.warn("[cancelJob] PI cancel failed:", error);
    }
    return;
  }

  if (job.paymentStatus === "captured") {
    try {
      await stripe.refunds.create({ payment_intent: job.paymentIntentId });
    } catch (error) {
      console.warn("[cancelJob] refund failed:", error);
    }
  }
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
  },
  stripeCustomerId: string | null,
  skipPayment: boolean
): Promise<boolean> {
  if (skipPayment || customerSkipsBilling({ skipPayment })) return false;

  const stripe = getStripe();
  if (!stripe) {
    throw new Error(SERVICE_UNAVAILABLE.stripe);
  }

  if (job.paymentStatus === "captured") {
    return true;
  }

  if (job.paymentStatus === "authorized" && job.paymentIntentId) {
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

  const priceDetails = await pricingService.calculatePrice({
    bedrooms: property.bedCount,
    bathrooms: Number(property.bathCount),
    sqft: property.sqFt || 0,
    laundryService: property.laundryType,
    laundryLoads: property.laundryLoads,
    hasHotTub: property.hasHotTub,
    hotTubService: property.hotTubServiceLevel,
    hotTubDrain: property.hotTubDrain,
    hotTubDrainCadence: property.hotTubDrainCadence,
  } as never);

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
  if (!job?.property || !job.subscription) {
    throw new Error("Job not found");
  }

  if (job.property.customerId !== customerId) {
    throw new Error("Forbidden");
  }

  const eligibility = canCancelJob(job.subscription, job, job.cleaners);
  if (!eligibility.allowed) {
    throw new Error(eligibility.reason ?? "Cannot cancel this clean");
  }

  return finalizeJobCancellation(job, eligibility.late, "customer");
}

export async function cancelJobAsAdmin(jobId: string): Promise<CancelJobResult> {
  const job = await loadJobContext(jobId);
  if (!job?.subscription) {
    throw new Error("Job not found");
  }

  const late = job.checkInTime
    ? job.cleaners.length > 0 &&
      new Date(job.checkInTime).getTime() - Date.now() < 24 * 60 * 60 * 1000
    : false;

  return finalizeJobCancellation(job, late, "admin");
}

async function finalizeJobCancellation(
  job: {
    id: string;
    expectedHours: string | null;
    paymentIntentId: string | null;
    paymentStatus: string | null;
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
      customer: {
        stripeCustomerId: string | null;
        skipPayment: boolean;
      } | null;
    } | null;
  },
  lateCancel: boolean,
  source: "customer" | "admin"
): Promise<CancelJobResult> {
  const assignments = job.cleaners;
  let customerCharged = false;
  let cleanerPaid = false;

  if (lateCancel) {
    if (!job.property) {
      throw new Error("Property not found for job");
    }
    customerCharged = await chargeCustomerForLateCancel(
      job.id,
      job,
      job.property,
      job.property.customer?.stripeCustomerId ?? null,
      job.property.customer?.skipPayment ?? false
    );
    cleanerPaid =
      (await createCleanerPayouts(job.id, job.expectedHours, assignments)) > 0;
  } else {
    await voidCustomerCharge(job);
  }

  await db.delete(jobsToCleaners).where(eq(jobsToCleaners.jobId, job.id));

  const notePrefix = lateCancel
    ? `[Late cancel – cleaner paid]`
    : `[On-time cancel – no charge]`;

  await db
    .update(jobs)
    .set({
      status: "canceled",
      notes: `${notePrefix} Canceled by ${source} at ${new Date().toISOString()}`,
      updatedAt: new Date(),
      ...(lateCancel ? {} : { paymentStatus: null, paymentIntentId: null }),
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

    await finalizeJobCancellation(upcomingJob, jobEligibility.late, "customer");
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
