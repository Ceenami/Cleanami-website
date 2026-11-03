import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
const TZ = "America/New_York";
export const PLANNING_PERIOD_DAYS = 14;
export type AvailabilityPeriod = {
  start: string;
  end: string;
  dates: string[];
};
export type AvailabilityDisplayMode =
  "submit" | "locked" | "override" | "preview";
export type DeadlineClosedReason =
  "outside_submission_window" | "past_sunday_deadline";
export type DeadlineStatus = {
  pastDeadline: boolean;
  canSubmitRegular: boolean;
  canEditPreferences: boolean;
  closedReason: DeadlineClosedReason | null;
  submissionSunday: string;
  nextSubmissionSunday: string;
  deadline: Date;
};
export type AvailabilityWindow = {
  period: AvailabilityPeriod;
  deadline: DeadlineStatus;
  displayMode: AvailabilityDisplayMode;
};
/** Calendar arithmetic is UTC only; timezone conversion happens once at boundaries. */
export function shiftCalendarDate(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(iso) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== iso
  )
    throw new Error("Invalid calendar date");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function easternToday(now = new Date()) {
  return formatInTimeZone(now, TZ, "yyyy-MM-dd");
}
function weekday(iso: string) {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}
export function getSubmissionSundayForPeriodStart(monday: string) {
  return shiftCalendarDate(monday, -1);
}
export function buildPeriodFromMonday(monday: string): AvailabilityPeriod {
  if (weekday(monday) !== 1)
    throw new Error("Planning periods must start Monday");
  const dates = Array.from({ length: 14 }, (_, i) =>
    shiftCalendarDate(monday, i),
  );
  return { start: dates[0], end: dates[13], dates };
}
export function findOperationalPeriodMonday(now = new Date()) {
  const today = easternToday(now);
  return shiftCalendarDate(today, -((weekday(today) + 6) % 7));
}
export function getSubmissionDeadline(date: string): Date {
  const monday = shiftCalendarDate(date, -((weekday(date) + 6) % 7));
  return fromZonedTime(`${shiftCalendarDate(monday, -1)}T18:00:00`, TZ);
}
export function isWithinSundaySubmissionWindow(
  monday: string,
  now = new Date(),
) {
  return (
    now >= fromZonedTime(`${shiftCalendarDate(monday, -1)}T00:00:00`, TZ) &&
    now < getSubmissionDeadline(monday)
  );
}
export function getDeadlineStatus(
  monday: string,
  now = new Date(),
): DeadlineStatus {
  const today = easternToday(now),
    sunday = shiftCalendarDate(today, (7 - weekday(today)) % 7),
    deadline = getSubmissionDeadline(monday);
  return {
    pastDeadline: now >= deadline,
    canSubmitRegular: true,
    canEditPreferences: true,
    closedReason: null,
    submissionSunday: shiftCalendarDate(monday, -1),
    nextSubmissionSunday:
      now >= fromZonedTime(`${sunday}T18:00:00`, TZ)
        ? shiftCalendarDate(sunday, 7)
        : sunday,
    deadline,
  };
}
/** Sunday plans the next Monday; other days include active and following week. */
export function getAvailabilityWindow(now = new Date()): AvailabilityWindow {
  const today = easternToday(now),
    monday =
      weekday(today) === 0
        ? shiftCalendarDate(today, 1)
        : findOperationalPeriodMonday(now);
  return {
    period: buildPeriodFromMonday(monday),
    deadline: getDeadlineStatus(monday, now),
    displayMode: "submit",
  };
}
export function getTwoWeekPeriod(now = new Date()) {
  return getAvailabilityWindow(now).period;
}
export function getMissedPeriodForOverride(
  now = new Date(),
): AvailabilityPeriod | null {
  const period = getAvailabilityWindow(now).period;
  return now >= getSubmissionDeadline(period.start) ? period : null;
}
export function dateAvailabilityLocked(date: string, now = new Date()) {
  return now >= getSubmissionDeadline(date);
}
function label(iso: string, options: Intl.DateTimeFormatOptions) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    ...options,
    timeZone: "UTC",
  });
}
export function formatDateRange(start: string, end: string) {
  return `${label(start, { month: "short", day: "numeric" })} – ${label(end, { month: "short", day: "numeric" })}`;
}
export function formatDayLabel(iso: string) {
  return label(iso, { weekday: "short", month: "short", day: "numeric" });
}
export function formatSubmissionSundayLabel(iso: string) {
  return label(iso, { weekday: "long", month: "long", day: "numeric" });
}
export function getSubmissionClosedMessage(
  _deadline: DeadlineStatus,
  _period: AvailabilityPeriod,
  _mode: AvailabilityDisplayMode,
) {
  return "Each week locks Sunday at 6 PM ET. Assigned dates cannot lose coverage. Late positive additions are recorded; contact admin for negative changes.";
}
