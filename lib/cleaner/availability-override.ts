import "server-only";

import {
  formatDateRange,
  getMissedPeriodForOverride,
  type AvailabilityPeriod,
} from "@/lib/cleaner/availability-deadline";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";

const TZ = "America/New_York";

export function getTodayEtIso(reference = new Date()): string {
  return format(toZonedTime(reference, TZ), "yyyy-MM-dd");
}

export type AvailabilityOverrideState = {
  canLateOverride: boolean;
  overridePeriod: AvailabilityPeriod | null;
  overrideMessage: string | null;
};

export function getLateOverrideMessage(period: AvailabilityPeriod): string {
  return `You missed the Sunday submission for ${formatDateRange(period.start, period.end)}. This is your one catch-up submission for this block — set all 14 days (including On-call and Open Pool).`;
}

export function resolveAvailabilityOverrideState(input: {
  lateOverridePeriodStart: string | null;
  existingRowCountForMissedPeriod: number;
  reference?: Date;
}): AvailabilityOverrideState {
  const missedPeriod = getMissedPeriodForOverride(input.reference);
  if (!missedPeriod) {
    return {
      canLateOverride: false,
      overridePeriod: null,
      overrideMessage: null,
    };
  }

  const overrideAlreadyUsed =
    input.lateOverridePeriodStart === missedPeriod.start;
  const hasSubmission = input.existingRowCountForMissedPeriod > 0;

  const canLateOverride = !overrideAlreadyUsed && !hasSubmission;

  return {
    canLateOverride,
    overridePeriod: canLateOverride ? missedPeriod : null,
    overrideMessage: canLateOverride
      ? getLateOverrideMessage(missedPeriod)
      : null,
  };
}

/** True when the date is on or after today (ET) within the period. */
export function isDateOnOrAfterTodayEt(
  date: string,
  reference = new Date()
): boolean {
  const today = getTodayEtIso(reference);
  return date >= today;
}

export function isDateBeforeTodayEt(
  date: string,
  reference = new Date()
): boolean {
  const today = getTodayEtIso(reference);
  return date < today;
}

export function assertOverrideDayAllowed(
  date: string,
  period: AvailabilityPeriod
): void {
  if (!period.dates.includes(date)) {
    throw new Error(`Date ${date} is outside the catch-up submission window`);
  }
}
