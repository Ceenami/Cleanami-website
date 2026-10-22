import { formatInTimeZone } from "date-fns-tz";
import {
  easternInstant,
  EXECUTION_ZONE,
  rentalSchedule,
} from "./execution-policy";

export type PropertyTimes = {
  defaultCheckOutTime?: string | null;
  defaultCheckInTime?: string | null;
};
export type ScheduleWindow = { start: Date; deadline: Date };
export type ScheduleCandidate = {
  id: string;
  status: string | null;
  serviceType: string;
  jobSource: string;
  calendarEventUid: string;
  checkInTime: Date | null;
  checkOutTime: Date | null;
  expectedHours: string | null;
  hasEvidence: boolean;
};
export type ScheduleChange = {
  jobId: string;
  beforeStart: string;
  beforeDeadline: string;
  start: string;
  deadline: string;
  expectedHours: string;
};
export type SchedulePlan = {
  changes: ScheduleChange[];
  preserved: { jobId: string; reason: string }[];
};
export type CalendarScheduleEvent = {
  end: Date;
  datetype?: string;
};
export type CalendarScheduleEntry = {
  event: CalendarScheduleEvent;
  next?: { start: Date; datetype?: string };
};

export function normalizedPropertyTimes(value: PropertyTimes) {
  const clock = (input: string | null | undefined, fallback: string) => {
    const result = input || fallback;
    const parts = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(result);
    if (!parts)
      throw new Error("Invalid property time. Use a valid time of day.");
    return `${parts[1].padStart(2, "0")}:${parts[2]}:${parts[3] ?? "00"}`;
  };
  return {
    defaultCheckOutTime: clock(value.defaultCheckOutTime, "09:00:00"),
    defaultCheckInTime: clock(value.defaultCheckInTime, "16:00:00"),
  };
}

export function propertyTimesChanged(
  before: PropertyTimes,
  after: PropertyTimes,
) {
  return (
    JSON.stringify(normalizedPropertyTimes(before)) !==
    JSON.stringify(normalizedPropertyTimes(after))
  );
}

function matches(job: ScheduleCandidate, window: ScheduleWindow) {
  return (
    job.checkInTime?.getTime() === +window.start &&
    job.checkOutTime?.getTime() === +window.deadline
  );
}

export function planPropertySchedules(input: {
  before: PropertyTimes;
  after: PropertyTimes;
  jobs: ScheduleCandidate[];
  calendar: Map<string, CalendarScheduleEntry>;
  overrides: Set<string>;
  now: Date;
}): SchedulePlan {
  const changes: ScheduleChange[] = [];
  const preserved: SchedulePlan["preserved"] = [];
  for (const job of [...input.jobs].sort((a, b) => a.id.localeCompare(b.id))) {
    const preserve = (reason: string) =>
      preserved.push({ jobId: job.id, reason });
    if (job.serviceType !== "vacation_rental_subscription") {
      preserve("chosen_residential_window");
      continue;
    }
    if (
      !["unassigned", "assigned"].includes(job.status ?? "") ||
      job.hasEvidence
    ) {
      preserve("started_or_finished");
      continue;
    }
    if (
      !job.checkInTime ||
      !job.checkOutTime ||
      +job.checkInTime <= +input.now
    ) {
      preserve("past_or_missing_schedule");
      continue;
    }
    if (input.overrides.has(job.id)) {
      preserve("individual_override");
      continue;
    }
    let previous: ScheduleWindow;
    let next: ScheduleWindow;
    if (job.jobSource === "ical") {
      const entry = input.calendar.get(job.calendarEventUid);
      if (!entry)
        throw new Error(
          `Calendar source for booking ${job.id} could not be verified. Refresh the calendar before changing times.`,
        );
      previous = rentalSchedule(entry.event, entry.next, input.before);
      next = rentalSchedule(entry.event, entry.next, input.after);
      // Older calendar inserts always used 09:00/16:00, even after property edits.
      // Preserve schedules that differ from both recognized baselines.
      const legacy = rentalSchedule(entry.event, entry.next, {});
      if (!matches(job, previous) && !matches(job, legacy)) {
        preserve("individual_override");
        continue;
      }
    } else if (["manual", "customer_one_off"].includes(job.jobSource)) {
      const day = formatInTimeZone(
        job.checkInTime,
        EXECUTION_ZONE,
        "yyyy-MM-dd",
      );
      const oldTimes = normalizedPropertyTimes(input.before);
      const newTimes = normalizedPropertyTimes(input.after);
      previous = {
        start: easternInstant(day, oldTimes.defaultCheckOutTime),
        deadline: easternInstant(day, oldTimes.defaultCheckInTime),
      };
      next = {
        start: easternInstant(day, newTimes.defaultCheckOutTime),
        deadline: easternInstant(day, newTimes.defaultCheckInTime),
      };
      if (!matches(job, previous)) {
        preserve("individual_override");
        continue;
      }
    } else {
      preserve("unknown_schedule_source");
      continue;
    }
    if (matches(job, next)) {
      preserve("already_current");
      continue;
    }
    const hours = Number(job.expectedHours);
    if (
      !Number.isFinite(hours) ||
      hours <= 0 ||
      +next.deadline - +next.start < hours * 3600000
    )
      throw new Error(
        `Booking ${job.id} would not have enough cleaning time. Adjust the property times or review this booking.`,
      );
    if (+next.start <= +input.now)
      throw new Error(
        `Booking ${job.id} would start in the past. Choose a later time.`,
      );
    changes.push({
      jobId: job.id,
      beforeStart: job.checkInTime.toISOString(),
      beforeDeadline: job.checkOutTime.toISOString(),
      start: next.start.toISOString(),
      deadline: next.deadline.toISOString(),
      expectedHours: job.expectedHours!,
    });
  }
  return { changes, preserved };
}
