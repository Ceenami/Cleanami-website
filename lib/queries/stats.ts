import { db } from '@/db';
import { jobs, properties } from '@/db/schemas';
import { getDashboardJobDateRange } from '@/lib/queries/dashboard-job-window';
import { getStartOfTodayEastern } from '@/lib/time/eastern';
import { sql, gte, lte, lt, and, inArray, eq, isNotNull } from 'drizzle-orm';
import { aggregations } from './utils/queryBuilder';

export async function getJobStats(customerId?: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const startOfTodayEastern = getStartOfTodayEastern();
  const { startDate: scheduleStart, endDate: scheduleEnd } =
    getDashboardJobDateRange();

  const activeStatusCondition = inArray(jobs.status, [
    'unassigned',
    'assigned',
    'in-progress',
  ]);

  /** Active work = open status and service date is today or later (Eastern). */
  const activeDateCondition = and(
    isNotNull(jobs.checkInTime),
    gte(jobs.checkInTime, startOfTodayEastern)
  )!;

  /** Matches the dashboard / job-oversight list window (last 7 days + 30 ahead). */
  const scheduleWindowCondition = and(
    isNotNull(jobs.checkInTime),
    gte(jobs.checkInTime, scheduleStart),
    lte(jobs.checkInTime, scheduleEnd)
  )!;

  const selectFields = {
    totalJobs: aggregations.count(jobs.id),
    totalInScheduleWindow: aggregations.countWhere(
      jobs.id,
      scheduleWindowCondition
    ),
    totalActive: aggregations.countWhere(
      jobs.id,
      and(activeStatusCondition, activeDateCondition)!
    ),
    totalToday: aggregations.countWhere(
      jobs.id,
      and(gte(jobs.checkInTime, today), lt(jobs.checkInTime, tomorrow))!
    ),
    totalCompleted: aggregations.countWhere(
      jobs.id,
      sql`${jobs.status} IN ('completed', 'awaiting_capture')`
    ),
    totalCanceled: aggregations.countWhere(
      jobs.id,
      sql`${jobs.status} = 'canceled'`
    ),
  };

  if (customerId) {
    const [stats] = await db
      .select(selectFields)
      .from(jobs)
      .innerJoin(properties, eq(jobs.propertyId, properties.id))
      .where(eq(properties.customerId, customerId));

    return stats;
  }

  const [stats] = await db.select(selectFields).from(jobs);

  return stats;
}
