/**
 * Residential arrival windows and the operating-day rule for which ones a given
 * home may be offered.
 *
 * Pure and dependency-free on purpose — the form, the booking service and the
 * verifiers all have to agree on this arithmetic.
 *
 * The window end is NOT the deadline. A job means arrive at check_in_time,
 * finish by check_out_time. The window's start is check_in_time; the deadline is
 * the window's end plus expected hours. Mapping a 9-11am window onto
 * check_out_time = 11:00 would tell a cleaner to finish a four-hour clean in two
 * and push a false late signal into reliability.
 *
 * Windows get filtered because cleaners submit availability for a 9am-4pm day. A
 * window whose latest arrival can't finish inside that day creates a job nobody
 * declared themselves available for, and the assignment engine can't explain the
 * empty pool. So a window is offered only when windowEnd + expectedHours <= 16:00.
 */

/** The cleaning day cleaners actually submit availability for. */
export const OPERATING_DAY_START_MINUTES = 9 * 60; // 09:00
export const OPERATING_DAY_END_MINUTES = 16 * 60; // 16:00

export type ArrivalWindowKey = "9-11" | "11-1" | "1-3" | "flexible-9-1";

export type ArrivalWindow = {
  key: ArrivalWindowKey;
  /** Customer-facing name. */
  label: string;
  /** What the cleaner is shown, e.g. "arrive between 9:00 AM and 11:00 AM". */
  cleanerLabel: string;
  /** Minutes past midnight, Eastern. The earliest the cleaner may arrive. */
  startMinutes: number;
  /** Minutes past midnight, Eastern. The latest the cleaner may arrive. */
  endMinutes: number;
};

/**
 * The windows we offer, in the order the customer sees them. "Flexible" is a
 * wider window, not a separate concept — it is last because a customer who has
 * a preference should see the specific slots first.
 */
export const ARRIVAL_WINDOWS: readonly ArrivalWindow[] = [
  {
    key: "9-11",
    label: "9:00 AM - 11:00 AM",
    cleanerLabel: "arrive between 9:00 AM and 11:00 AM",
    startMinutes: 9 * 60,
    endMinutes: 11 * 60,
  },
  {
    key: "11-1",
    label: "11:00 AM - 1:00 PM",
    cleanerLabel: "arrive between 11:00 AM and 1:00 PM",
    startMinutes: 11 * 60,
    endMinutes: 13 * 60,
  },
  {
    key: "1-3",
    label: "1:00 PM - 3:00 PM",
    cleanerLabel: "arrive between 1:00 PM and 3:00 PM",
    startMinutes: 13 * 60,
    endMinutes: 15 * 60,
  },
  {
    key: "flexible-9-1",
    label: "Flexible (9:00 AM - 1:00 PM)",
    cleanerLabel: "arrive between 9:00 AM and 1:00 PM",
    startMinutes: 9 * 60,
    endMinutes: 13 * 60,
  },
] as const;

export const ARRIVAL_WINDOW_KEYS = ARRIVAL_WINDOWS.map((w) => w.key) as [
  ArrivalWindowKey,
  ...ArrivalWindowKey[],
];

export function getArrivalWindow(
  key: string | undefined | null
): ArrivalWindow | undefined {
  return ARRIVAL_WINDOWS.find((w) => w.key === key);
}

/** `HH:MM:SS`, the shape the `time` columns and the form both use. */
export function minutesToTimeOfDay(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

/**
 * Must-finish-before: the window END plus the expected hours, rounded up
 * to the minute so a fractional hour never quietly shortens the deadline.
 */
export function mustFinishBeforeMinutes(
  window: ArrivalWindow,
  expectedHours: number
): number {
  return window.endMinutes + Math.ceil(expectedHours * 60);
}

/**
 * A window is honest only if the LATEST arrival it permits still finishes
 * inside the operating day. Checking the window start instead would offer a
 * slot we know a late-arriving cleaner cannot complete.
 */
export function windowFitsOperatingDay(
  window: ArrivalWindow,
  expectedHours: number
): boolean {
  if (!Number.isFinite(expectedHours) || expectedHours <= 0) return false;
  if (window.startMinutes < OPERATING_DAY_START_MINUTES) return false;
  return mustFinishBeforeMinutes(window, expectedHours) <= OPERATING_DAY_END_MINUTES;
}

/**
 * The windows this job may be offered. Empty is a legitimate answer — a home
 * whose clean runs longer than the widest remaining slot allows cannot be sold
 * a window we cannot staff, and the booking refuses rather than pretending.
 * `residentialWindowRefusal()` in `residential-notice.ts` is that refusal.
 */
export function getAvailableArrivalWindows(
  expectedHours: number
): ArrivalWindow[] {
  return ARRIVAL_WINDOWS.filter((w) => windowFitsOperatingDay(w, expectedHours));
}
