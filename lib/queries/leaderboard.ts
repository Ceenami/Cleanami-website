import "server-only";

import { db } from "@/db";
import {
  cleanerBadges,
  cleaners,
  jobs,
  jobsToCleaners,
  payouts,
  ratings,
  reliabilityEvents,
} from "@/db/schemas";
import { avg, count, desc, eq, sum } from "drizzle-orm";

/** Current run of consecutive most-recent on-time/early arrivals (a "streak"). */
export async function getCleanerOnTimeStreak(
  cleanerId: string
): Promise<number> {
  const events = await db
    .select({ eventType: reliabilityEvents.eventType })
    .from(reliabilityEvents)
    .where(eq(reliabilityEvents.cleanerId, cleanerId))
    .orderBy(desc(reliabilityEvents.createdAt))
    .limit(100);

  let streak = 0;
  for (const e of events) {
    if (e.eventType === "on_time" || e.eventType === "early_arrival") streak += 1;
    else break;
  }
  return streak;
}

export type LeaderboardRow = {
  cleanerId: string;
  fullName: string;
  reliabilityScore: number;
  jobsCompleted: number;
  badgesCount: number;
  earnings: number;
  averageStars: number | null;
  rank: number;
};

/**
 * In-repo leaderboard (replaces the orphaned get_leaderboard() SQL which relied
 * on the never-populated job_stats table). Ranks by reliability, then completed
 * jobs, then badges, then earnings.
 */
export async function getLeaderboard(limit = 25): Promise<LeaderboardRow[]> {
  const [cleanerRows, jobsAgg, badgesAgg, earningsAgg, ratingsAgg] =
    await Promise.all([
      db
        .select({
          id: cleaners.id,
          fullName: cleaners.fullName,
          reliabilityScore: cleaners.reliabilityScore,
        })
        .from(cleaners)
        .where(eq(cleaners.eligibleForAssignments, true)),
      db
        .select({ cleanerId: jobsToCleaners.cleanerId, c: count(jobsToCleaners.jobId) })
        .from(jobsToCleaners)
        .innerJoin(jobs, eq(jobsToCleaners.jobId, jobs.id))
        .where(eq(jobs.status, "completed"))
        .groupBy(jobsToCleaners.cleanerId),
      db
        .select({ cleanerId: cleanerBadges.cleanerId, c: count(cleanerBadges.id) })
        .from(cleanerBadges)
        .groupBy(cleanerBadges.cleanerId),
      db
        .select({ cleanerId: payouts.cleanerId, total: sum(payouts.amount) })
        .from(payouts)
        .where(eq(payouts.status, "released"))
        .groupBy(payouts.cleanerId),
      db
        .select({
          cleanerId: ratings.cleanerId,
          avg: avg(ratings.stars),
        })
        .from(ratings)
        .groupBy(ratings.cleanerId),
    ]);

  const jobsMap = new Map(jobsAgg.map((r) => [r.cleanerId, Number(r.c)]));
  const badgesMap = new Map(badgesAgg.map((r) => [r.cleanerId, Number(r.c)]));
  const earningsMap = new Map(
    earningsAgg.map((r) => [r.cleanerId, Number(r.total ?? 0)])
  );
  const ratingsMap = new Map(
    ratingsAgg.map((r) => [
      r.cleanerId,
      r.avg != null ? Math.round(Number(r.avg) * 10) / 10 : null,
    ])
  );

  const rows = cleanerRows
    .map((c) => ({
      cleanerId: c.id,
      fullName: c.fullName,
      reliabilityScore: parseFloat(c.reliabilityScore ?? "100"),
      jobsCompleted: jobsMap.get(c.id) ?? 0,
      badgesCount: badgesMap.get(c.id) ?? 0,
      earnings: earningsMap.get(c.id) ?? 0,
      averageStars: ratingsMap.get(c.id) ?? null,
    }))
    .sort((a, b) => {
      if (b.reliabilityScore !== a.reliabilityScore)
        return b.reliabilityScore - a.reliabilityScore;
      if (b.jobsCompleted !== a.jobsCompleted)
        return b.jobsCompleted - a.jobsCompleted;
      if (b.badgesCount !== a.badgesCount) return b.badgesCount - a.badgesCount;
      return b.earnings - a.earnings;
    })
    .slice(0, limit)
    .map((r, idx) => ({ ...r, rank: idx + 1 }));

  return rows;
}
