import "server-only";

import { db } from "@/db";
import { jobs, jobsToCleaners } from "@/db/schemas";
import { and, eq, isNotNull, lt, ne, sql } from "drizzle-orm";

/**
 * Duration assumed for a job whose `expectedHours` was never computed.
 *
 * Jobs normally get `expectedHours` from the staffing calculation at creation,
 * so this only covers a data gap. It sits in the middle of the range the
 * cleaning-time formula produces for real properties (roughly 2.5-5 hrs):
 * large enough that a genuine overlap is still caught, small enough that it
 * does not block a cleaner from a job they could actually work.
 */
export const DEFAULT_EXPECTED_JOB_HOURS = 4;

function toHours(value: string | number | null | undefined): number {
  const hours = Number(value);
  return Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_EXPECTED_JOB_HOURS;
}

/**
 * True when the cleaner already has a job whose working window overlaps the
 * one being considered.
 *
 * This deliberately compares *windows*, not start times. Comparing start times
 * for equality only flagged jobs beginning at the same instant, so two cleans
 * ninety minutes apart — which one cleaner cannot possibly work — looked free
 * and were happily double-booked.
 *
 * Overlap is the standard half-open test: an existing job conflicts when it
 * starts before this job ends AND ends after this job starts. Touching
 * endpoints (one job ending exactly as the next begins) do not conflict.
 */
export async function hasScheduleConflict(input: {
  cleanerId: string;
  checkInTime: Date;
  /** Expected hours for the job being considered; falls back to the default. */
  expectedHours?: string | number | null;
  /** Job to ignore — normally the one being assigned. */
  excludeJobId?: string;
}): Promise<boolean> {
  const { cleanerId, checkInTime, expectedHours, excludeJobId } = input;

  const start = checkInTime;
  const end = new Date(start.getTime() + toHours(expectedHours) * 60 * 60 * 1000);

  const rows = await db
    .select({ jobId: jobs.id })
    .from(jobsToCleaners)
    .innerJoin(jobs, eq(jobsToCleaners.jobId, jobs.id))
    .where(
      and(
        eq(jobsToCleaners.cleanerId, cleanerId),
        ne(jobs.status, "canceled"),
        isNotNull(jobs.checkInTime),
        // existing.start < this.end
        lt(jobs.checkInTime, end),
        // existing.start + existing.duration > this.start
        //
        // `start` is serialised with .toISOString() rather than passed as a
        // Date. Inside a raw `sql` template drizzle applies no column type
        // mapper, so postgres-js receives the JS Date verbatim and throws
        // ERR_INVALID_ARG_TYPE ("must be of type string or Buffer"). That threw
        // for every candidate, so assignJob() threw on every job and
        // runAssignmentEngine() swallowed it into summary.errors — the engine
        // could never assign anything. The `lt()` above is unaffected because
        // drizzle maps typed column comparisons itself.
        sql`${jobs.checkInTime} + (COALESCE(${jobs.expectedHours}::double precision, ${DEFAULT_EXPECTED_JOB_HOURS}::double precision) * interval '1 hour') > ${start.toISOString()}::timestamptz`,
        excludeJobId ? ne(jobs.id, excludeJobId) : undefined
      )
    )
    .limit(1);

  return rows.length > 0;
}
