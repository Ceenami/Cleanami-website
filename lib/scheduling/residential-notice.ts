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

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const TIME_ONLY = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Residential arrival times are selectable in 15-minute increments, 9 AM–4 PM ET. */
export const RESIDENTIAL_DAY_START_MINUTES = 9 * 60;
export const RESIDENTIAL_DAY_END_MINUTES = 16 * 60;
export const RESIDENTIAL_ARRIVAL_INCREMENT_MINUTES = 15;

export function timeToMinutes(time: string | undefined | null): number | null {
  if (!time || !TIME_ONLY.test(time)) return null;
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function isResidentialArrivalTime(time: string | undefined | null): boolean {
  const minutes = timeToMinutes(time);
  return (
    minutes !== null &&
    minutes >= RESIDENTIAL_DAY_START_MINUTES &&
    minutes <= RESIDENTIAL_DAY_END_MINUTES &&
    minutes % RESIDENTIAL_ARRIVAL_INCREMENT_MINUTES === 0
  );
}

export function formatResidentialArrivalTime(time: string | undefined | null): string | null {
  const minutes = timeToMinutes(time);
  if (minutes === null) return null;
  const hours = Math.floor(minutes / 60);
  const minutePart = minutes % 60;
  return `${hours % 12 || 12}:${String(minutePart).padStart(2, "0")} ${
    hours >= 12 ? "PM" : "AM"
  }`;
}

/** `YYYY-MM-DD` for the Eastern calendar day an instant falls on. */
export function toEasternDateKey(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: EASTERN_TZ });
}

/**
 * When the cleaner would arrive: the chosen Eastern date at the selected time,
 * as a real UTC instant.
 *
 * Returns null rather than an Invalid Date. `Invalid Date < earliest` is false,
 * so a malformed time would sail past a buffer check and only be rejected by
 * Postgres after the card was charged. Null cannot be compared by accident.
 */
export function getArrivalInstant(
  cleanDate: string,
  arrivalTime: string | undefined | null
): Date | null {
  if (!DATE_ONLY.test(cleanDate) || !isResidentialArrivalTime(arrivalTime)) return null;

  const instant = fromZonedTime(
    `${cleanDate}T${arrivalTime}:00`,
    EASTERN_TZ
  );
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/**
 * Internal must-finish-before: selected arrival plus expected hours. It may
 * fall after 4 PM; 4 PM is a latest arrival, not a turnover deadline.
 */
export function getDeadlineInstant(
  cleanDate: string,
  arrivalTime: string | undefined | null,
  expectedHours: number
): Date | null {
  if (!Number.isFinite(expectedHours) || expectedHours <= 0) return null;
  const arrival = getArrivalInstant(cleanDate, arrivalTime);
  if (!arrival) return null;
  return new Date(arrival.getTime() + Math.ceil(expectedHours * 60) * 60 * 1000);
}

/** Does this date + selected arrival time give us at least 48 hours' notice? */
export function meetsResidentialNotice(
  cleanDate: string,
  arrivalTime: string | undefined | null,
  now: Date = new Date()
): boolean {
  const arrival = getArrivalInstant(cleanDate, arrivalTime);
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
export function getBookableArrivalTimes(
  cleanDate: string,
  now: Date = new Date()
): string[] {
  const times: string[] = [];
  for (
    let minutes = RESIDENTIAL_DAY_START_MINUTES;
    minutes <= RESIDENTIAL_DAY_END_MINUTES;
    minutes += RESIDENTIAL_ARRIVAL_INCREMENT_MINUTES
  ) {
    const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(
      minutes % 60
    ).padStart(2, "0")}`;
    if (meetsResidentialNotice(cleanDate, time, now)) times.push(time);
  }
  return times;
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
  now: Date = new Date(),
  maxDaysAhead = 14
): string | null {
  const startOfSearch = new Date(
    now.getTime() + RESIDENTIAL_NOTICE_HOURS * 60 * 60 * 1000
  );

  for (let offset = 0; offset <= maxDaysAhead; offset++) {
    const candidate = toEasternDateKey(
      new Date(startOfSearch.getTime() + offset * 24 * 60 * 60 * 1000)
    );
    if (getBookableArrivalTimes(candidate, now).length > 0) {
      return candidate;
    }
  }
  return null;
}
