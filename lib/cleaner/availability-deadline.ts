import { addDays, format } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

const TZ = "America/New_York";
export const PLANNING_PERIOD_DAYS = 14;

export type AvailabilityPeriod = {
  start: string;
  end: string;
  dates: string[];
};

export type AvailabilityDisplayMode = "submit" | "locked" | "override" | "preview";

export type DeadlineClosedReason =
  | "outside_submission_window"
  | "past_sunday_deadline";

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

function parseEtNoon(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return toZonedTime(new Date(year, month - 1, day, 12, 0, 0), TZ);
}

function toEtIso(date: Date): string {
  return format(toZonedTime(date, TZ), "yyyy-MM-dd");
}

/** Sunday immediately before the period-start Monday. */
export function getSubmissionSundayForPeriodStart(
  periodStartMonday: string
): string {
  return toEtIso(addDays(parseEtNoon(periodStartMonday), -1));
}

export function buildPeriodFromMonday(periodStartMonday: string): AvailabilityPeriod {
  const periodStart = parseEtNoon(periodStartMonday);
  const dates: string[] = [];
  for (let i = 0; i < PLANNING_PERIOD_DAYS; i++) {
    dates.push(toEtIso(addDays(periodStart, i)));
  }
  return {
    start: dates[0],
    end: dates[dates.length - 1],
    dates,
  };
}

/** Monday starting the 14-day block that contains `today` (ET). */
export function findOperationalPeriodMonday(now = new Date()): string {
  const todayIso = toEtIso(toZonedTime(now, TZ));

  for (let offset = 0; offset < PLANNING_PERIOD_DAYS; offset++) {
    const candidate = addDays(parseEtNoon(todayIso), -offset);
    if (candidate.getDay() !== 1) continue;
    const mondayIso = toEtIso(candidate);
    const period = buildPeriodFromMonday(mondayIso);
    if (period.dates.includes(todayIso)) return mondayIso;
  }

  const today = parseEtNoon(todayIso);
  const day = today.getDay();
  const daysFromMonday = day === 0 ? 6 : day - 1;
  return toEtIso(addDays(today, -daysFromMonday));
}

function findNextPeriodMonday(periodStartMonday: string): string {
  return toEtIso(addDays(parseEtNoon(periodStartMonday), PLANNING_PERIOD_DAYS));
}

function findNextSubmissionSunday(fromEt: Date): string {
  const startIso = toEtIso(fromEt);
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = addDays(parseEtNoon(startIso), offset);
    if (candidate.getDay() === 0) return toEtIso(candidate);
  }
  return toEtIso(addDays(fromEt, 7));
}

function getSubmissionWindowStart(periodStartMonday: string): Date {
  const submissionSundayIso =
    getSubmissionSundayForPeriodStart(periodStartMonday);
  const sundayLocal = parseEtNoon(submissionSundayIso);
  sundayLocal.setHours(0, 0, 0, 0);
  return fromZonedTime(sundayLocal, TZ);
}

/** Sunday 6 PM ET immediately before the period start date. */
export function getSubmissionDeadline(periodStartDate: string): Date {
  const periodStart = parseEtNoon(periodStartDate);
  const dayOfWeek = periodStart.getDay();
  const daysBack = dayOfWeek === 0 ? 7 : dayOfWeek;

  const deadlineLocal = addDays(periodStart, -daysBack);
  deadlineLocal.setHours(18, 0, 0, 0);

  return fromZonedTime(deadlineLocal, TZ);
}

export function isWithinSundaySubmissionWindow(
  periodStartMonday: string,
  now = new Date()
): boolean {
  const windowStart = getSubmissionWindowStart(periodStartMonday);
  const deadline = getSubmissionDeadline(periodStartMonday);
  return now >= windowStart && now <= deadline;
}

/**
 * Period the cleaner missed on Sunday and may still submit via one late override.
 * Returns null when no catch-up is needed for scheduling UI.
 */
export function getMissedPeriodForOverride(now = new Date()): AvailabilityPeriod | null {
  const todayIso = toEtIso(toZonedTime(now, TZ));
  const operationalMonday = findOperationalPeriodMonday(now);
  const operationalPeriod = buildPeriodFromMonday(operationalMonday);
  const nextMonday = findNextPeriodMonday(operationalMonday);
  const nextPeriod = buildPeriodFromMonday(nextMonday);
  const nextSubmissionSunday =
    getSubmissionSundayForPeriodStart(nextMonday);

  if (
    todayIso > nextSubmissionSunday &&
    todayIso < nextPeriod.start
  ) {
    return nextPeriod;
  }

  const operationalSubmissionSunday =
    getSubmissionSundayForPeriodStart(operationalMonday);
  if (
    operationalPeriod.dates.includes(todayIso) &&
    todayIso > operationalSubmissionSunday
  ) {
    return operationalPeriod;
  }

  return null;
}

function buildClosedDeadline(
  periodStartMonday: string,
  now: Date,
  overrides: Partial<DeadlineStatus> = {}
): DeadlineStatus {
  const base = getDeadlineStatus(periodStartMonday, now);
  return {
    ...base,
    canSubmitRegular: false,
    canEditPreferences: false,
    ...overrides,
  };
}

export function getAvailabilityWindow(now = new Date()): AvailabilityWindow {
  const nowEt = toZonedTime(now, TZ);
  const todayIso = toEtIso(nowEt);

  if (nowEt.getDay() === 0) {
    const nextMonday = toEtIso(addDays(parseEtNoon(todayIso), 1));
    const nextPeriod = buildPeriodFromMonday(nextMonday);
    if (isWithinSundaySubmissionWindow(nextMonday, now)) {
      return {
        period: nextPeriod,
        deadline: getDeadlineStatus(nextMonday, now),
        displayMode: "submit",
      };
    }
  }

  const operationalMonday = findOperationalPeriodMonday(now);
  const operationalPeriod = buildPeriodFromMonday(operationalMonday);
  const nextPeriodMonday = findNextPeriodMonday(operationalMonday);
  const nextSubmissionSunday =
    getSubmissionSundayForPeriodStart(nextPeriodMonday);

  return {
    period: operationalPeriod,
    deadline: buildClosedDeadline(operationalMonday, now, {
      canEditPreferences: true,
      closedReason: "outside_submission_window",
      submissionSunday: getSubmissionSundayForPeriodStart(operationalMonday),
      nextSubmissionSunday,
    }),
    displayMode: "locked",
  };
}

/** Active 14-day planning block for the current moment. */
export function getTwoWeekPeriod(now = new Date()): AvailabilityPeriod {
  return getAvailabilityWindow(now).period;
}

export function getDeadlineStatus(
  periodStartDate: string,
  now = new Date()
): DeadlineStatus {
  const nowEt = toZonedTime(now, TZ);
  const submissionSunday = getSubmissionSundayForPeriodStart(periodStartDate);
  const nextSubmissionSunday = findNextSubmissionSunday(nowEt);
  const deadline = getSubmissionDeadline(periodStartDate);
  const inWindow = isWithinSundaySubmissionWindow(periodStartDate, now);

  if (!inWindow) {
    return {
      pastDeadline: now > deadline,
      canSubmitRegular: false,
      canEditPreferences: false,
      closedReason: now > deadline
        ? "past_sunday_deadline"
        : "outside_submission_window",
      submissionSunday,
      nextSubmissionSunday,
      deadline,
    };
  }

  return {
    pastDeadline: false,
    canSubmitRegular: true,
    canEditPreferences: true,
    closedReason: null,
    submissionSunday,
    nextSubmissionSunday,
    deadline,
  };
}

export function formatDateRange(start: string, end: string): string {
  const fmt = (iso: string) =>
    parseEtNoon(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: TZ,
    });
  return `${fmt(start)} – ${fmt(end)}`;
}

export function formatDayLabel(iso: string): string {
  return parseEtNoon(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: TZ,
  });
}

export function formatSubmissionSundayLabel(iso: string): string {
  return parseEtNoon(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: TZ,
  });
}

export function getSubmissionClosedMessage(
  deadline: DeadlineStatus,
  period: AvailabilityPeriod,
  displayMode: AvailabilityDisplayMode
): string {
  const periodRange = formatDateRange(period.start, period.end);
  const nextSunday = formatSubmissionSundayLabel(deadline.nextSubmissionSunday);

  if (displayMode === "locked") {
    return `Availability for ${periodRange} is locked. You can still update On-Call and Open Pool for days you marked available. Next full submission: ${nextSunday} before 6 PM ET.`;
  }

  if (displayMode === "override") {
    return `You missed the Sunday submission window. Use your one catch-up submission below for ${periodRange}, then preferences only until ${nextSunday}.`;
  }

  if (deadline.closedReason === "outside_submission_window") {
    return `Submissions for ${periodRange} open every Sunday at 12:00 AM ET and close at 6 PM ET. Next window: ${nextSunday}.`;
  }

  if (deadline.closedReason === "past_sunday_deadline") {
    return `Sunday submissions for ${periodRange} closed at 6 PM ET. Use your one catch-up submission if you have not already, or wait until ${nextSunday}.`;
  }

  return `Submissions are currently closed. Next submission: ${nextSunday} before 6 PM ET.`;
}
