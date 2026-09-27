import "server-only";

import { db, sequentialQueries } from "@/db";
import {
  availability,
  cleanerAvailabilitySubmissions,
  jobs,
} from "@/db/schemas";
import { getTwoWeekPeriod } from "@/lib/cleaner/availability-deadline";
import { and, asc, gte, lte, ne } from "drizzle-orm";
import { fromZonedTime } from "date-fns-tz";

const EASTERN_TZ = "America/New_York";
const MAX_DAYS = 31;

export type AdminCleanerScheduleRange = { start: string; end: string };

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
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

  const days = Math.round(
    (endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)
  ) + 1;
  if (days > MAX_DAYS) {
    throw new Error(`The staffing view supports at most ${MAX_DAYS} days`);
  }

  return { start, end };
}

function easternBoundary(isoDate: string, endOfDay = false): Date {
  return fromZonedTime(
    `${isoDate}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`,
    EASTERN_TZ
  );
}

/**
 * Admin-only operational staffing read. The four DB reads deliberately stay
 * sequential: the production transaction pooler drops pipelined queries.
 */
export async function getAdminCleanerSchedule(
  requestedRange?: { start?: string | null; end?: string | null }
) {
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
            lte(availability.date, range.end)
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
            gte(cleanerAvailabilitySubmissions.periodEnd, range.start)
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
            gte(jobs.checkInTime, startAt),
            lte(jobs.checkInTime, endAt),
            ne(jobs.status, "canceled")
          ),
          columns: {
            id: true,
            status: true,
            checkInTime: true,
            checkOutTime: true,
            serviceType: true,
          },
          with: {
            property: { columns: { address: true } },
            cleaners: {
              columns: { cleanerId: true, role: true },
            },
          },
          orderBy: [asc(jobs.checkInTime)],
        })
    );

  return {
    range,
    cleaners: cleanerRows,
    availability: availabilityRows,
    submissions: submissionRows,
    jobs: jobRows.map((job) => ({
      id: job.id,
      status: job.status,
      checkInTime: job.checkInTime,
      checkOutTime: job.checkOutTime,
      serviceType: job.serviceType,
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
