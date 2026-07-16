import "server-only";

import { db } from "@/db";
import {
  badges,
  cleanerBadges,
  cleaners,
  jobs,
  jobsToCleaners,
  ratings,
} from "@/db/schemas";
import { and, avg, count, eq } from "drizzle-orm";
import type { BadgeRequirement } from "@/lib/services/badges/badge-definitions";

type CleanerBadgeStats = {
  reliabilityScore: number;
  hasHotTubCert: boolean;
  jobsCompleted: number;
  laundryJobs: number;
  onCallJobs: number;
  avgRating: number | null;
  ratingCount: number;
};

async function gatherStats(cleanerId: string): Promise<CleanerBadgeStats | null> {
  const cleaner = await db.query.cleaners.findFirst({
    where: eq(cleaners.id, cleanerId),
    columns: { reliabilityScore: true, hasHotTubCert: true },
  });
  if (!cleaner) return null;

  const [completed] = await db
    .select({ c: count(jobsToCleaners.jobId) })
    .from(jobsToCleaners)
    .innerJoin(jobs, eq(jobsToCleaners.jobId, jobs.id))
    .where(
      and(
        eq(jobsToCleaners.cleanerId, cleanerId),
        eq(jobs.status, "completed")
      )
    );

  const [laundry] = await db
    .select({ c: count(jobsToCleaners.jobId) })
    .from(jobsToCleaners)
    .innerJoin(jobs, eq(jobsToCleaners.jobId, jobs.id))
    .where(
      and(
        eq(jobsToCleaners.cleanerId, cleanerId),
        eq(jobsToCleaners.role, "laundry_lead"),
        eq(jobs.status, "completed")
      )
    );

  const [onCall] = await db
    .select({ c: count(jobsToCleaners.jobId) })
    .from(jobsToCleaners)
    .innerJoin(jobs, eq(jobsToCleaners.jobId, jobs.id))
    .where(
      and(
        eq(jobsToCleaners.cleanerId, cleanerId),
        eq(jobsToCleaners.role, "on-call"),
        eq(jobs.status, "completed")
      )
    );

  const [rating] = await db
    .select({ avg: avg(ratings.stars), c: count(ratings.id) })
    .from(ratings)
    .where(eq(ratings.cleanerId, cleanerId));

  return {
    reliabilityScore: parseFloat(cleaner.reliabilityScore ?? "100"),
    hasHotTubCert: Boolean(cleaner.hasHotTubCert),
    jobsCompleted: Number(completed?.c ?? 0),
    laundryJobs: Number(laundry?.c ?? 0),
    onCallJobs: Number(onCall?.c ?? 0),
    avgRating: rating?.avg != null ? Number(rating.avg) : null,
    ratingCount: Number(rating?.c ?? 0),
  };
}

function meetsRequirement(
  req: BadgeRequirement,
  stats: CleanerBadgeStats
): boolean {
  switch (req.type) {
    case "reliability_min":
      return stats.reliabilityScore >= req.value;
    case "hot_tub_cert":
      return stats.hasHotTubCert;
    case "jobs_completed":
      return stats.jobsCompleted >= req.value;
    case "laundry_jobs":
      return stats.laundryJobs >= req.value;
    case "on_call_jobs":
      return stats.onCallJobs >= req.value;
    case "avg_rating_min":
      return (
        stats.avgRating != null &&
        stats.ratingCount >= req.minCount &&
        stats.avgRating >= req.value
      );
    default:
      return false;
  }
}

/**
 * Evaluate every badge for a cleaner and award any newly-qualified ones.
 * Idempotent (unique cleaner+badge). Call after job completion, reliability
 * recompute, or a new rating. Returns the ids of badges awarded this run.
 */
export async function evaluateBadgesForCleaner(
  cleanerId: string
): Promise<string[]> {
  const stats = await gatherStats(cleanerId);
  if (!stats) return [];

  const allBadges = await db.select().from(badges);
  if (allBadges.length === 0) return []; // catalog not seeded yet

  const earned = await db
    .select({ badgeId: cleanerBadges.badgeId })
    .from(cleanerBadges)
    .where(eq(cleanerBadges.cleanerId, cleanerId));
  const earnedIds = new Set(earned.map((e) => e.badgeId));

  const awarded: string[] = [];
  for (const badge of allBadges) {
    if (earnedIds.has(badge.id)) continue;
    const req = badge.requirements as BadgeRequirement;
    if (!meetsRequirement(req, stats)) continue;

    await db
      .insert(cleanerBadges)
      .values({ cleanerId, badgeId: badge.id })
      .onConflictDoNothing();
    awarded.push(badge.id);
  }

  return awarded;
}
