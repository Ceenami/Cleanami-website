import { formatInTimeZone } from "date-fns-tz";

const TZ = "America/New_York";

/**
 * Fallback when a property has no explicit guest checkout time. Matches the
 * `properties.default_check_out_time` column default and the spec's 9AM–4PM
 * cleaning window.
 */
export const DEFAULT_WINDOW_OPEN_TIME = "09:00:00";

/**
 * The instant the cleaning window opens is the persisted booking start.
 * Property defaults are inputs at creation/rescheduling, never live visit gates.
 */
export function resolveCheckInWindowOpensAt(
  scheduledCheckIn: Date,
  ..._legacyPropertyTime: [propertyCheckOutTime?: string | null]
): Date {
  void _legacyPropertyTime;
  return new Date(scheduledCheckIn);
}

export type CheckInWindowEvaluation = {
  /** The booking's persisted cleaning start. */
  opensAt: Date;
  /** Minutes until the window opens; 0 once it is open. */
  minutesEarly: number;
  /** True when the cleaner is trying to check in before the window opens. */
  isEarly: boolean;
};

/**
 * Decide whether a check-in attempt is too early.
 *
 * Only the early side is evaluated. Late check-in is deliberately not blocked:
 * the spec prices lateness (reliability hit, then $5/10min, then removal and
 * replacement at 1 hour) rather than refusing it, and a cleaner who cannot
 * check in could never complete the job or be paid for it.
 *
 * Returns null when the job has no scheduled time — there is nothing to anchor
 * the window to, so the caller should allow the check-in rather than block on
 * missing data.
 */
export function evaluateCheckInWindow(input: {
  scheduledCheckIn: Date | null;
  propertyCheckOutTime: string | null | undefined;
  now: Date;
}): CheckInWindowEvaluation | null {
  const { scheduledCheckIn, propertyCheckOutTime, now } = input;
  if (!scheduledCheckIn) return null;

  const opensAt = resolveCheckInWindowOpensAt(scheduledCheckIn, propertyCheckOutTime);
  const msEarly = opensAt.getTime() - now.getTime();

  return {
    opensAt,
    minutesEarly: msEarly > 0 ? Math.ceil(msEarly / 60000) : 0,
    isEarly: msEarly > 0,
  };
}

/** Window-open time rendered for the cleaner, e.g. "9:00 AM". */
export function formatWindowTimeEt(opensAt: Date): string {
  return formatInTimeZone(opensAt, TZ, "h:mm a");
}
