import "server-only";

import { db } from "@/db";
import { jobs, jobsToCleaners } from "@/db/schemas";
import { and, eq, isNotNull, lt, ne, sql } from "drizzle-orm";
import { toEasternDateString } from "@/lib/time/eastern";

/**
 * Fallback for a job whose expectedHours was never computed. Mid-range for real
 * properties (~2.5-5 hrs): big enough to catch a genuine overlap, small enough
 * not to block a job the cleaner could work. Only the `window` rule reads it.
 */
export const DEFAULT_EXPECTED_JOB_HOURS = 4;

/**
 * Which question we are asking of the cleaner's calendar.
 *
 * - `same_day` — may this cleaner be auto-assigned? No cleaner works more than
 *   one job of any type on the same calendar day unless a Super Admin
 *   overrides. This is the policy and the default.
 * - `window` — could they physically work it? Do the two working windows
 *   overlap. Two non-overlapping cleans on one day pass.
 *
 * Both are kept, because the difference is policy-blocked (hours are free, an
 * override makes sense) versus impossible (no override puts one person in two
 * places). The urgent-replacement flow needs to tell those apart to offer a
 * meaningful override.
 */
export type ScheduleConflictRule = "same_day" | "window";

export type ScheduleConflict = {
  jobId: string;
  checkInTime: Date | null;
  serviceType: string | null;
  /** The Eastern calendar day the conflicting job falls on, `YYYY-MM-DD`. */
  easternDate: string | null;
  /** Which rule flagged it. `same_day` is override-able; `window` is not. */
  rule: ScheduleConflictRule;
};

export type ScheduleConflictInput = {
  cleanerId: string;
  checkInTime: Date;
  /** Expected hours for the job being considered; falls back to the default. */
  expectedHours?: string | number | null;
  /** Job to ignore — normally the one being assigned. */
  excludeJobId?: string;
  /** Defaults to `same_day`, which is the policy. See `ScheduleConflictRule`. */
  rule?: ScheduleConflictRule;
};

function toHours(value: string | number | null | undefined): number {
  const hours = Number(value);
  return Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_EXPECTED_JOB_HOURS;
}

/**
 * The cleaner's first clashing job under `rule`, or null. Returns the job rather
 * than a boolean so the caller can say what it clashed with — the reassign route
 * puts the other job's date and service type in its 409.
 *
 * Two defects this query has already had:
 *
 * 1. Comparing start times for equality only caught jobs beginning at the same
 *    instant, so two cleans ninety minutes apart looked free.
 * 2. Passing a JS Date into a raw `sql` template threw ERR_INVALID_ARG_TYPE for
 *    every candidate — drizzle applies no type mapper inside a raw template, so
 *    postgres-js gets the Date verbatim. The engine swallowed it into
 *    summary.errors and reported success while assigning nothing. Serialise
 *    values inside `sql` templates yourself; lt()/eq()/ne() map themselves.
 */
export async function findScheduleConflict(
  input: ScheduleConflictInput
): Promise<ScheduleConflict | null> {
  const {
    cleanerId,
    checkInTime,
    expectedHours,
    excludeJobId,
    rule = "same_day",
  } = input;

  // Day predicate in America/New_York. Slicing an ISO string reads the UTC date
  // and lands on the next day for anything after 8pm Eastern — availability
  // shipped that bug once already. A job at 2026-09-03T01:00Z is 21:00 Eastern
  // on the 2nd: this gives 2026-09-02, a naive ::date gives 2026-09-03.
  //
  // Passed as a string, not a Date — see defect 2 above.
  //
  // No index on the expression, deliberately: the query filters by cleaner_id
  // first, so it only ever evaluates over one cleaner's jobs.
  const sameDayPredicate = sql`(${jobs.checkInTime} AT TIME ZONE 'America/New_York')::date = ${toEasternDateString(
    checkInTime
  )}::date`;

  /**
   * The window predicate: an existing job conflicts when it starts before this
   * job ends AND ends after this job starts. Touching endpoints (one job ending
   * exactly as the next begins) do not conflict.
   */
  const end = new Date(
    checkInTime.getTime() + toHours(expectedHours) * 60 * 60 * 1000
  );

  const rows = await db
    .select({
      jobId: jobs.id,
      checkInTime: jobs.checkInTime,
      serviceType: jobs.serviceType,
    })
    .from(jobsToCleaners)
    .innerJoin(jobs, eq(jobsToCleaners.jobId, jobs.id))
    .where(
      and(
        eq(jobsToCleaners.cleanerId, cleanerId),
        // Unchanged: a completed job still blocks. Whether it should is a
        // separate question and not one to answer quietly here.
        ne(jobs.status, "canceled"),
        isNotNull(jobs.checkInTime),
        rule === "same_day"
          ? sameDayPredicate
          : and(
              // existing.start < this.end
              lt(jobs.checkInTime, end),
              // existing.start + existing.duration > this.start
              sql`${jobs.checkInTime} + (COALESCE(${jobs.expectedHours}::double precision, ${DEFAULT_EXPECTED_JOB_HOURS}::double precision) * interval '1 hour') > ${checkInTime.toISOString()}::timestamptz`
            ),
        excludeJobId ? ne(jobs.id, excludeJobId) : undefined
      )
    )
    .orderBy(jobs.checkInTime)
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    jobId: row.jobId,
    checkInTime: row.checkInTime,
    serviceType: row.serviceType,
    easternDate: row.checkInTime ? toEasternDateString(row.checkInTime) : null,
    rule,
  };
}

/**
 * True when the cleaner already has a job that clashes under `rule`.
 *
 * Defaults to same_day: one job of any type per cleaner per calendar day. Note
 * this changed semantics — it used to compare windows, so two non-overlapping
 * cleans on one day were allowed.
 */
export async function hasScheduleConflict(
  input: ScheduleConflictInput
): Promise<boolean> {
  return (await findScheduleConflict(input)) !== null;
}
