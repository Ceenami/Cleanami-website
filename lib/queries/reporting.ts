import "server-only";

import { db } from "@/db";
import {
  disputes,
  jobs,
  payouts,
  reliabilityEvents,
  reserveTransactions,
  subscriptions,
} from "@/db/schemas";
import { count, eq, sql, sum } from "drizzle-orm";

export type ReportingSummary = {
  revenue: number; // dollars (gross captured)
  cleanerPayouts: number; // dollars (released)
  reserveHeld: number; // dollars (2% reserve)
  margin: number; // revenue - payouts
  jobs: {
    total: number;
    completed: number;
    canceled: number;
    upcoming: number;
    assignedUpcoming: number;
  };
  coverageRate: number; // assignedUpcoming / upcoming
  disputeRate: number; // disputes / completed
  lateRate: number; // late arrivals / arrival events
  retentionRate: number; // active / (active + canceled)
  subscriptions: { active: number; paused: number; canceled: number };
};

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10; // one decimal %
}

export async function getReportingSummary(): Promise<ReportingSummary> {
  const [
    revenueRow,
    payoutRow,
    jobStatusRows,
    upcomingRow,
    assignedUpcomingRow,
    disputeCountRow,
    arrivalRows,
    subStatusRows,
  ] = await Promise.all([
    db
      .select({
        total: sum(reserveTransactions.totalAmountCents),
        reserve: sum(reserveTransactions.reserveAmountCents),
      })
      .from(reserveTransactions),
    db
      .select({ total: sum(payouts.amount) })
      .from(payouts)
      .where(eq(payouts.status, "released")),
    db
      .select({ status: jobs.status, c: count(jobs.id) })
      .from(jobs)
      .groupBy(jobs.status),
    db
      .select({ c: count(jobs.id) })
      .from(jobs)
      .where(sql`${jobs.checkInTime} > now() and ${jobs.status} <> 'canceled'`),
    db
      .select({ c: count(jobs.id) })
      .from(jobs)
      .where(
        sql`${jobs.checkInTime} > now() and ${jobs.status} not in ('canceled','unassigned')`
      ),
    db.select({ c: count(disputes.id) }).from(disputes),
    db
      .select({ eventType: reliabilityEvents.eventType, c: count(reliabilityEvents.id) })
      .from(reliabilityEvents)
      .groupBy(reliabilityEvents.eventType),
    db
      .select({ status: subscriptions.status, c: count(subscriptions.id) })
      .from(subscriptions)
      .groupBy(subscriptions.status),
  ]);

  const revenueCents = Number(revenueRow[0]?.total ?? 0);
  const reserveCents = Number(revenueRow[0]?.reserve ?? 0);
  const cleanerPayouts = Number(payoutRow[0]?.total ?? 0);
  const revenue = revenueCents / 100;

  const jobStatus = new Map(jobStatusRows.map((r) => [r.status, Number(r.c)]));
  const completed = jobStatus.get("completed") ?? 0;
  const canceled = jobStatus.get("canceled") ?? 0;
  const totalJobs = jobStatusRows.reduce((acc, r) => acc + Number(r.c), 0);
  const upcoming = Number(upcomingRow[0]?.c ?? 0);
  const assignedUpcoming = Number(assignedUpcomingRow[0]?.c ?? 0);

  const disputeCount = Number(disputeCountRow[0]?.c ?? 0);

  const arrivalMap = new Map(arrivalRows.map((r) => [r.eventType, Number(r.c)]));
  const lateArrivals = arrivalMap.get("late_arrival") ?? 0;
  const totalArrivals = arrivalRows.reduce((acc, r) => acc + Number(r.c), 0);

  const subStatus = new Map(subStatusRows.map((r) => [r.status, Number(r.c)]));
  const activeSubs = subStatus.get("active") ?? 0;
  const pausedSubs = subStatus.get("paused") ?? 0;
  const canceledSubs = subStatus.get("canceled") ?? 0;

  return {
    revenue,
    cleanerPayouts,
    reserveHeld: reserveCents / 100,
    margin: revenue - cleanerPayouts,
    jobs: {
      total: totalJobs,
      completed,
      canceled,
      upcoming,
      assignedUpcoming,
    },
    coverageRate: pct(assignedUpcoming, upcoming),
    disputeRate: pct(disputeCount, completed),
    lateRate: pct(lateArrivals, totalArrivals),
    retentionRate: pct(activeSubs, activeSubs + canceledSubs),
    subscriptions: {
      active: activeSubs,
      paused: pausedSubs,
      canceled: canceledSubs,
    },
  };
}
