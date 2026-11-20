import { addMonths, differenceInHours } from "date-fns";
import { legacySubscriptionMinimum, subscriptionMinimumLabel, withinSubscriptionMinimum, type SubscriptionMinimum } from "@/lib/subscriptions/minimum";

export const CANCEL_NOTICE_HOURS = 24;

const CANCELABLE_JOB_STATUSES = new Set([
  "unassigned",
  "assigned",
]);

export type SubscriptionForCancel = {
  startDate: string | Date;
  status: string;
  cancellationMinimum?: SubscriptionMinimum;
};

export type JobForCancel = {
  status: string | null;
  checkInTime: Date | string | null;
};

export function isWithinFirstMonth(subscription: SubscriptionForCancel): boolean {
  const start = new Date(subscription.startDate);
  const firstMonthEnd = addMonths(start, 1);
  return new Date() < firstMonthEnd;
}

export function hoursUntilCheckIn(checkInTime: Date | string): number {
  return differenceInHours(new Date(checkInTime), new Date());
}

export function hasAssignedCleaner(
  assignments: { role: string }[]
): boolean {
  return assignments.some(
    (a) => a.role === "primary" || a.role === "laundry_lead"
  );
}

export function isLateCancellation(
  checkInTime: Date | string,
  assignments: { role: string }[]
): boolean {
  return (
    hoursUntilCheckIn(checkInTime) < CANCEL_NOTICE_HOURS &&
    hasAssignedCleaner(assignments)
  );
}

export function canCancelSubscription(subscription: SubscriptionForCancel, now = new Date()): {
  allowed: boolean;
  reason: string | null;
} {
  if (subscription.status !== "active") {
    return { allowed: false, reason: "Only active subscriptions can be canceled" };
  }

  const minimum = subscription.cancellationMinimum ?? legacySubscriptionMinimum(subscription.startDate);
  if (withinSubscriptionMinimum(minimum, now)) {
    return {
      allowed: false,
      reason: `Your ${subscriptionMinimumLabel(minimum).toLowerCase()} has not ended. You can manage individual cleans from your dashboard.`,
    };
  }

  return { allowed: true, reason: null };
}

export function canCancelJob(
  subscription: SubscriptionForCancel | null,
  job: JobForCancel,
  assignments: { role: string }[]
): { allowed: boolean; late: boolean; reason: string | null } {
  if (!job.checkInTime) {
    return { allowed: false, late: false, reason: "Job has no scheduled time" };
  }

  if (!job.status || !CANCELABLE_JOB_STATUSES.has(job.status)) {
    return {
      allowed: false,
      late: false,
      reason: "This clean cannot be canceled in its current state",
    };
  }

  if (new Date(job.checkInTime).getTime() <= Date.now()) {
    return {
      allowed: false,
      late: false,
      reason: "Past or in-progress cleans cannot be canceled here",
    };
  }

  const late = isLateCancellation(job.checkInTime, assignments);

  // A standalone one-time clean has no subscription and therefore no first
  // month exception. It follows the normal 24-hour notice rule.
  if (
    (!subscription || !isWithinFirstMonth(subscription)) &&
    hoursUntilCheckIn(job.checkInTime) < CANCEL_NOTICE_HOURS &&
    !late
  ) {
    return {
      allowed: false,
      late: false,
      reason: `Cleans must be canceled at least ${CANCEL_NOTICE_HOURS} hours before check-in unless a cleaner is already assigned (late-cancel rules apply).`,
    };
  }

  return { allowed: true, late, reason: null };
}
