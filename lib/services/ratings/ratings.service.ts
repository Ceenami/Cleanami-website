import "server-only";

import { db } from "@/db";
import { jobs, jobsToCleaners, ratings } from "@/db/schemas";
import { and, avg, count, eq } from "drizzle-orm";
import { evaluateBadgesForCleaner } from "@/lib/services/badges/badges.service";

export type SubmitRatingResult = {
  jobId: string;
  cleanerId: string;
  stars: number;
};

/**
 * Record (or update) a customer's rating for a completed clean. Verifies the
 * customer owns the job and the job is completed, then attributes the rating to
 * the job's primary cleaner.
 */
export async function submitRating(input: {
  jobId: string;
  customerId: string;
  stars: number;
  comment?: string | null;
}): Promise<SubmitRatingResult> {
  const job = await db.query.jobs.findFirst({
    where: eq(jobs.id, input.jobId),
    with: { property: { columns: { customerId: true } } },
  });

  if (!job || !job.property) {
    throw new Error("Job not found");
  }
  if (job.property.customerId !== input.customerId) {
    throw new Error("Forbidden");
  }
  if (job.status !== "completed") {
    throw new Error("Only completed cleans can be rated");
  }

  const primary = await db.query.jobsToCleaners.findFirst({
    where: and(
      eq(jobsToCleaners.jobId, input.jobId),
      eq(jobsToCleaners.role, "primary")
    ),
    columns: { cleanerId: true },
  });

  if (!primary) {
    throw new Error("No cleaner is attributed to this clean");
  }

  await db
    .insert(ratings)
    .values({
      jobId: input.jobId,
      cleanerId: primary.cleanerId,
      customerId: input.customerId,
      stars: input.stars,
      comment: input.comment ?? null,
    })
    .onConflictDoUpdate({
      target: ratings.jobId,
      set: { stars: input.stars, comment: input.comment ?? null },
    });

  // Ratings can unlock performance badges.
  await evaluateBadgesForCleaner(primary.cleanerId);

  return {
    jobId: input.jobId,
    cleanerId: primary.cleanerId,
    stars: input.stars,
  };
}

export type CleanerRatingSummary = {
  averageStars: number | null;
  ratingCount: number;
};

export async function getCleanerRatingSummary(
  cleanerId: string
): Promise<CleanerRatingSummary> {
  const [row] = await db
    .select({
      avg: avg(ratings.stars),
      count: count(ratings.id),
    })
    .from(ratings)
    .where(eq(ratings.cleanerId, cleanerId));

  return {
    averageStars: row?.avg != null ? Math.round(Number(row.avg) * 10) / 10 : null,
    ratingCount: Number(row?.count ?? 0),
  };
}
