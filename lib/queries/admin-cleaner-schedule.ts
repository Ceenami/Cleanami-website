import "server-only";

import { db, sequentialQueries } from "@/db";
import {
  availability,
  cleanerAvailabilitySubmissions,
  jobs,
  availabilityDays,
} from "@/db/schemas";
import { getTwoWeekPeriod } from "@/lib/cleaner/availability-deadline";
import { and, asc, gte, lte, ne, or, isNull, inArray } from "drizzle-orm";
import { fromZonedTime } from "date-fns-tz";
import { dateAvailabilityLocked } from "@/lib/cleaner/availability-deadline";
import { jobOperationsWarning } from "@/lib/jobs/operations-status";
import { getJobDisplay } from "@/lib/constants/service-type";
import { scheduleWarnings } from "@/lib/jobs/schedule-warnings";

const EASTERN_TZ = "America/New_York";
const MAX_DAYS = 31;

export type AdminCleanerScheduleRange = { start: string; end: string };

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
    ? null
    : date;
}

export function resolveAdminCleanerScheduleRange(input?: {
  start?: string | null;
  end?: string | null;
}): AdminCleanerScheduleRange {
  const defaultPeriod = getTwoWeekPeriod();
  const start = input?.start ?? defaultPeriod.start;
  const end = input?.end ?? defaultPeriod.end;
  const startDate = parseIsoDate(start);
  const endDate = parseIsoDate(end);

  if (!startDate || !endDate || endDate < startDate) {
    throw new Error("start and end must be valid YYYY-MM-DD dates");
  }

  const days =
    Math.round(
      (endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000),
    ) + 1;
  if (days > MAX_DAYS) {
    throw new Error(`The staffing view supports at most ${MAX_DAYS} days`);
  }

  return { start, end };
}

function easternBoundary(isoDate: string, endOfDay = false): Date {
  return fromZonedTime(
    `${isoDate}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`,
    EASTERN_TZ,
  );
}

/**
 * Admin-only operational staffing read. The four DB reads deliberately stay
 * sequential: the production transaction pooler drops pipelined queries.
 */
export async function getAdminCleanerSchedule(requestedRange?: {
  start?: string | null;
  end?: string | null;
}) {
  const range = resolveAdminCleanerScheduleRange(requestedRange);
  const startAt = easternBoundary(range.start);
  const endAt = easternBoundary(range.end, true);

  const [cleanerRows, availabilityRows, submissionRows, jobRows] =
    await sequentialQueries(
      () =>
        db.query.cleaners.findMany({
          columns: {
            id: true,
            fullName: true,
            accountStatus: true,
            eligibleForAssignments: true,
            reliabilityScore: true,
          },
          orderBy: (table, { asc: orderAsc }) => [orderAsc(table.fullName)],
        }),
      () =>
        db.query.availability.findMany({
          where: and(
            gte(availability.date, range.start),
            lte(availability.date, range.end),
          ),
          columns: {
            cleanerId: true,
            date: true,
            onCallEligible: true,
            openPoolEligible: true,
            startTime: true,
            endTime: true,
          },
        }),
      () =>
        db.query.cleanerAvailabilitySubmissions.findMany({
          where: and(
            lte(cleanerAvailabilitySubmissions.periodStart, range.end),
            gte(cleanerAvailabilitySubmissions.periodEnd, range.start),
          ),
          columns: {
            cleanerId: true,
            periodStart: true,
            periodEnd: true,
            submissionMode: true,
            firstSubmittedAt: true,
            lastUpdatedAt: true,
          },
        }),
      () =>
        db.query.jobs.findMany({
          where: and(
            or(
              and(gte(jobs.checkInTime, startAt), lte(jobs.checkInTime, endAt)),
              and(
                isNull(jobs.checkInTime),
                inArray(jobs.status, ["unassigned", "assigned"]),
              ),
            ),
            ne(jobs.status, "canceled"),
          ),
          columns: {
            id: true,
            status: true,
            checkInTime: true,
            checkOutTime: true,
            serviceType: true,
            addonsSnapshot: true,
            expectedHours: true,
            checklistSnapshot: true,
            jobLabel: true,
          },
          with: {
            property: { columns: { address: true } },
            evidencePacket: { columns: { gpsCheckInTimestamp: true } },
            cleaners: {
              columns: { cleanerId: true, role: true },
              with: {
                cleaner: {
                  columns: { hasHotTubCert: true, hasLaundryLeadCert: true },
                },
              },
            },
          },
          orderBy: [asc(jobs.checkInTime)],
        }),
    );

  const dayStates = await db
    .select()
    .from(availabilityDays)
    .where(
      and(
        gte(availabilityDays.date, range.start),
        lte(availabilityDays.date, range.end),
      ),
    );
  const conflicts = scheduleWarnings(jobRows);
  return {
    range,
    dateLocks: Object.fromEntries(
      Array.from(
        {
          length:
            Math.round(
              (new Date(`${range.end}T12:00Z`).getTime() -
                new Date(`${range.start}T12:00Z`).getTime()) /
                86400000,
            ) + 1,
        },
        (_, i) => {
          const d = new Date(`${range.start}T12:00Z`);
          d.setUTCDate(d.getUTCDate() + i);
          const date = d.toISOString().slice(0, 10);
          return [date, dateAvailabilityLocked(date)];
        },
      ),
    ),
    cleaners: cleanerRows,
    availability: availabilityRows,
    submissions: submissionRows,
    dayStates: dayStates.map((day) => ({
      ...day,
      locked:
        dateAvailabilityLocked(day.date) &&
        !(day.reopenedUntil && day.reopenedUntil > new Date()),
    })),
    jobs: jobRows.map((job) => ({
      id: job.id,
      status: job.status,
      checkInTime: job.checkInTime,
      checkOutTime: job.checkOutTime,
      serviceType: job.serviceType,
      serviceLabel: getJobDisplay(job).label,
      warning:
        [
          jobOperationsWarning({
            ...job,
            checkedIn: !!job.evidencePacket?.gpsCheckInTimestamp,
          }),
          ...(conflicts.get(job.id) ?? []),
          ...(job.cleaners.filter((a) =>
            ["primary", "laundry_lead"].includes(a.role),
          ).length < (job.addonsSnapshot?.teamSize ?? 1)
            ? ["Working team incomplete"]
            : []),
          ...(((job.addonsSnapshot?.hotTubServiceLevel &&
            job.addonsSnapshot.hotTubServiceLevel !== "none") ||
            job.checklistSnapshot?.capabilityRequirements?.hotTub) &&
          !job.cleaners.some(
            (a) =>
              ["primary", "laundry_lead"].includes(a.role) &&
              a.cleaner.hasHotTubCert,
          )
            ? ["Hot-tub capability missing"]
            : []),
          ...((job.addonsSnapshot?.laundryType === "off_site" ||
            job.checklistSnapshot?.capabilityRequirements?.laundryLead) &&
          !job.cleaners.some(
            (a) => a.role === "laundry_lead" && a.cleaner.hasLaundryLeadCert,
          )
            ? ["Certified laundry lead missing"]
            : []),
        ]
          .filter(Boolean)
          .join(" · ") || null,
      propertyAddress: job.property?.address ?? "Unknown address",
      assignments: job.cleaners.map((assignment) => ({
        cleanerId: assignment.cleanerId,
        role: assignment.role,
      })),
    })),
  };
}

export type AdminCleanerSchedule = Awaited<
  ReturnType<typeof getAdminCleanerSchedule>
>;
