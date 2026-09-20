/**
 * The 48-hour rule, and the Eastern-time instants a residential booking is built
 * from.
 *
 * Under 48 hours is a block, not a queue: no request row, no hold, no approval.
 *
 * Enforced in three places — the date picker won't offer the date, the schema
 * refines on it, and the booking service re-checks before any PaymentIntent
 * exists. The first is a courtesy; the other two are the rule.
 *
 * Two things that are easy to get wrong:
 *
 * - Measured from the START of the arrival window, not midnight of the chosen
 *   date. Midnight accepts a 9am clean booked at 10am two days earlier — 47
 *   hours sold as 48.
 * - Evaluated in America/New_York, not UTC and not the browser clock, so a
 *   customer in Los Angeles gets the same answer the server does.
 */
import { fromZonedTime } from "date-fns-tz";
import {
  getArrivalWindow,
  getAvailableArrivalWindows,
  minutesToTimeOfDay,
  type ArrivalWindow,
} from "./arrival-windows";

const EASTERN_TZ = "America/New_York";

/** Counterproposal item 8. */
export const RESIDENTIAL_NOTICE_HOURS = 48;

/**
 * The client's own customer-facing wording, verbatim
 *. Do not paraphrase it — it is the sentence
 * Phase 2A is accepted against.
 */
export const RESIDENTIAL_NOTICE_MESSAGE =
  "One-time house cleanings require at least 48 hours notice so we can properly staff your clean.";

/**
 * Shown when no arrival window can finish inside the 9am-4pm operating day for
 * this home (`arrival-windows.ts`). Selling a window we cannot staff is the
 * failure mode we already know: a booking that prices fine and cannot be worked.
 */
export const RESIDENTIAL_NO_WINDOW_MESSAGE =
  "This home needs more time than our standard arrival windows allow, so we cannot schedule it online. Please contact CleanNami support and we will arrange it for you.";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` for the Eastern calendar day an instant falls on. */
export function toEasternDateKey(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: EASTERN_TZ });
}

/**
 * When the cleaner would arrive: the chosen Eastern date at the window's start,
 * as a real UTC instant.
 *
 * Returns null rather than an Invalid Date. `Invalid Date < earliest` is false,
 * so a malformed time would sail past a buffer check and only be rejected by
 * Postgres after the card was charged. Null cannot be compared by accident.
 */
export function getArrivalInstant(
  cleanDate: string,
  windowKey: string | undefined | null
): Date | null {
  if (!DATE_ONLY.test(cleanDate)) return null;

  const window = getArrivalWindow(windowKey);
  if (!window) return null;

  const instant = fromZonedTime(
    `${cleanDate}T${minutesToTimeOfDay(window.startMinutes)}`,
    EASTERN_TZ
  );
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/**
 * The must-finish-before instant: the window END plus the job's expected
 * hours. Same null-on-unusable contract as `getArrivalInstant`.
 */
export function getDeadlineInstant(
  cleanDate: string,
  windowKey: string | undefined | null,
  expectedHours: number
): Date | null {
  if (!DATE_ONLY.test(cleanDate)) return null;
  if (!Number.isFinite(expectedHours) || expectedHours <= 0) return null;

  const window = getArrivalWindow(windowKey);
  if (!window) return null;

  const instant = fromZonedTime(
    `${cleanDate}T${minutesToTimeOfDay(
      window.endMinutes + Math.ceil(expectedHours * 60)
    )}`,
    EASTERN_TZ
  );
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/** Does this date + window give us at least 48 hours' notice? */
export function meetsResidentialNotice(
  cleanDate: string,
  windowKey: string | undefined | null,
  now: Date = new Date()
): boolean {
  const arrival = getArrivalInstant(cleanDate, windowKey);
  if (!arrival) return false;

  const earliest = now.getTime() + RESIDENTIAL_NOTICE_HOURS * 60 * 60 * 1000;
  return arrival.getTime() >= earliest;
}

/**
 * The windows this home may be offered on this date: the operating-day filter
 * (`arrival-windows.ts`) intersected with the 48-hour rule.
 *
 * Both filters at once, because a date can be partly bookable — at 10am on a
 * Monday, Wednesday's 9-11am slot is 47 hours out and refused while its 1-3pm
 * slot is 51 hours out and fine. Offering the date and then refusing the slot
 * is a worse experience than showing only what can actually be booked.
 */
export function getBookableWindows(
  cleanDate: string,
  expectedHours: number,
  now: Date = new Date()
): ArrivalWindow[] {
  return getAvailableArrivalWindows(expectedHours).filter((w) =>
    meetsResidentialNotice(cleanDate, w.key, now)
  );
}

/**
 * The earliest Eastern date on which at least one window is bookable, so the
 * refusal can pre-select it and the picker can start there. Item 8 turns a
 * customer away; the least it can do is say when they *can* book.
 *
 * Scans forward a bounded number of days and returns `null` if none qualifies,
 * which only happens when no window fits the home at all.
 */
export function earliestBookableDate(
  expectedHours: number,
  now: Date = new Date(),
  maxDaysAhead = 14
): string | null {
  if (getAvailableArrivalWindows(expectedHours).length === 0) return null;

  const startOfSearch = new Date(
    now.getTime() + RESIDENTIAL_NOTICE_HOURS * 60 * 60 * 1000
  );

  for (let offset = 0; offset <= maxDaysAhead; offset++) {
    const candidate = toEasternDateKey(
      new Date(startOfSearch.getTime() + offset * 24 * 60 * 60 * 1000)
    );
    if (getBookableWindows(candidate, expectedHours, now).length > 0) {
      return candidate;
    }
  }
  return null;
}
