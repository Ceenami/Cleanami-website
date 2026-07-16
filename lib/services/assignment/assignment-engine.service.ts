import "server-only";

import { db } from "@/db";
import {
  cleaners,
  jobs,
  jobsToCleaners,
  properties,
  propertyCleaners,
} from "@/db/schemas";
import type { PropertyCleanerTier } from "@/db/schemas";
import { isCleanerAssignmentEligible } from "@/lib/cleaner/eligibility";
import { getAvailableCleanersForProperty } from "@/lib/queries/cleaners-proximity";
import { notifyCleaner } from "@/lib/services/notifications/notify";
import { sendCleanerAssignmentEmail } from "@/lib/services/email.service";
import { and, eq, gt, ne } from "drizzle-orm";

/** Best-effort multichannel notify of a newly-assigned primary cleaner. */
async function notifyAssignedPrimary(
  jobId: string,
  cleanerId: string,
  propertyId: string,
  checkInTime: Date | null
): Promise<void> {
  try {
    const [cleaner, property] = await Promise.all([
      db.query.cleaners.findFirst({
        where: eq(cleaners.id, cleanerId),
        columns: { fullName: true, email: true },
      }),
      db.query.properties.findFirst({
        where: eq(properties.id, propertyId),
        columns: { address: true },
      }),
    ]);
    const address = property?.address ?? "your assigned property";
    const jobDate = checkInTime ? checkInTime.toLocaleString() : "soon";

    await notifyCleaner({
      cleanerId,
      type: "assignment",
      title: "New job assigned",
      message: `You've been assigned a clean at ${address} on ${jobDate}.`,
      jobId,
      url: "/cleaner/jobs",
    });

    if (cleaner?.email) {
      await sendCleanerAssignmentEmail({
        to: cleaner.email,
        name: cleaner.fullName,
        propertyAddress: address,
        jobDate,
      });
    }
  } catch (err) {
    console.error("[assignment-engine] notify failed:", err);
  }
}

/**
 * Reliability gates (0–100), from the functionality spec §13:
 *  - >= 95  : eligible to be a job's PRIMARY cleaner
 *  - >= 90  : may still be primary only if no >=95 candidate exists (degrade)
 *  - >= 80  : eligible for backup / on-call, never preferred as primary
 *  - <  80  : flagged — not auto-assigned at all
 */
const RELIABILITY_MIN_ELIGIBLE = 80;
const RELIABILITY_PREFERRED_PRIMARY = 95;
const RELIABILITY_FALLBACK_PRIMARY = 90;

/** Missing score defaults to 100 (a brand-new cleaner with no events). */
function scoreOf(reliabilityScore: string | null): number {
  const n = parseFloat(reliabilityScore ?? "100");
  return Number.isFinite(n) ? n : 100;
}

const TIER_PRIORITY: Record<PropertyCleanerTier, number> = {
  main_primary: 0,
  secondary_primary: 1,
  preferred_backup: 2,
  on_call: 3,
};

type Candidate = {
  cleanerId: string;
  score: number;
  /** roster candidates come first (respect the property hierarchy). */
  source: "roster" | "proximity";
  tier?: PropertyCleanerTier;
};

export type AssignmentOutcome =
  | { jobId: string; status: "assigned"; primaryCleanerId: string; backupCleanerId: string | null }
  | { jobId: string; status: "skipped"; reason: string };

export type AssignmentSummary = {
  assigned: number;
  skipped: number;
  errors: Array<{ jobId: string; error: string }>;
  outcomes: AssignmentOutcome[];
};

/** True if the cleaner already has a job starting at exactly this time. */
async function hasScheduleConflict(
  cleanerId: string,
  checkInTime: Date,
  excludeJobId: string
): Promise<boolean> {
  const rows = await db
    .select({ jobId: jobs.id })
    .from(jobsToCleaners)
    .innerJoin(jobs, eq(jobsToCleaners.jobId, jobs.id))
    .where(
      and(
        eq(jobsToCleaners.cleanerId, cleanerId),
        eq(jobs.checkInTime, checkInTime),
        ne(jobs.status, "canceled"),
        ne(jobs.id, excludeJobId)
      )
    )
    .limit(1);

  return rows.length > 0;
}

/** Property hierarchy roster, tier-then-sortOrder ordered, eligibility resolved. */
async function getPropertyRosterCandidates(
  propertyId: string
): Promise<Candidate[]> {
  const roster = await db
    .select({
      cleanerId: propertyCleaners.cleanerId,
      tier: propertyCleaners.tier,
      sortOrder: propertyCleaners.sortOrder,
      reliabilityScore: cleaners.reliabilityScore,
      eligibleForAssignments: cleaners.eligibleForAssignments,
    })
    .from(propertyCleaners)
    .innerJoin(cleaners, eq(propertyCleaners.cleanerId, cleaners.id))
    .where(eq(propertyCleaners.propertyId, propertyId));

  return roster
    .filter((r) => isCleanerAssignmentEligible(r))
    .sort((a, b) => {
      const ta = TIER_PRIORITY[a.tier as PropertyCleanerTier];
      const tb = TIER_PRIORITY[b.tier as PropertyCleanerTier];
      if (ta !== tb) return ta - tb;
      return a.sortOrder - b.sortOrder;
    })
    .map((r) => ({
      cleanerId: r.cleanerId,
      score: scoreOf(r.reliabilityScore),
      source: "roster" as const,
      tier: r.tier as PropertyCleanerTier,
    }));
}

/**
 * Build the ordered candidate list for a job: the property hierarchy first,
 * then the proximity/reliability ranked pool for anyone not already listed.
 */
async function buildCandidates(
  propertyId: string
): Promise<Candidate[]> {
  const rosterCandidates = await getPropertyRosterCandidates(propertyId);
  const seen = new Set(rosterCandidates.map((c) => c.cleanerId));

  let proximity: Candidate[] = [];
  try {
    const ranked = await getAvailableCleanersForProperty(propertyId, {
      includeOnJob: false,
    });
    proximity = ranked
      .filter((c) => !seen.has(c.id))
      .map((c) => ({
        cleanerId: c.id,
        score: scoreOf(c.reliabilityScore),
        source: "proximity" as const,
      }));
  } catch (err) {
    // Property not geocoded / no coords — roster-only assignment still works.
    console.warn(
      `[assignment-engine] proximity ranking failed for property ${propertyId}:`,
      err instanceof Error ? err.message : err
    );
  }

  return [...rosterCandidates, ...proximity];
}

/** Assign one job. Idempotent: safe to re-run (re-selects primary/backup). */
export async function assignJob(job: {
  id: string;
  propertyId: string | null;
  checkInTime: Date | null;
}): Promise<AssignmentOutcome> {
  if (!job.propertyId || !job.checkInTime) {
    return { jobId: job.id, status: "skipped", reason: "missing property or check-in time" };
  }

  const candidates = await buildCandidates(job.propertyId);

  // Filter to reliability-eligible candidates with no schedule clash.
  const eligible: Candidate[] = [];
  for (const c of candidates) {
    if (c.score < RELIABILITY_MIN_ELIGIBLE) continue;
    if (await hasScheduleConflict(c.cleanerId, job.checkInTime, job.id)) continue;
    eligible.push(c);
  }

  if (eligible.length === 0) {
    return { jobId: job.id, status: "skipped", reason: "no eligible cleaner" };
  }

  // Primary: prefer >=95 in priority order, then >=90, else the first eligible.
  const primary =
    eligible.find((c) => c.score >= RELIABILITY_PREFERRED_PRIMARY) ??
    eligible.find((c) => c.score >= RELIABILITY_FALLBACK_PRIMARY) ??
    eligible[0];

  const backup =
    eligible.find((c) => c.cleanerId !== primary.cleanerId) ?? null;

  await db.transaction(async (tx) => {
    // Clear any prior auto-assignment for these roles (idempotent re-run).
    await tx
      .delete(jobsToCleaners)
      .where(
        and(
          eq(jobsToCleaners.jobId, job.id),
          eq(jobsToCleaners.role, "primary")
        )
      );
    await tx
      .delete(jobsToCleaners)
      .where(
        and(
          eq(jobsToCleaners.jobId, job.id),
          eq(jobsToCleaners.role, "backup")
        )
      );

    await tx.insert(jobsToCleaners).values({
      jobId: job.id,
      cleanerId: primary.cleanerId,
      role: "primary",
    });

    if (backup) {
      await tx.insert(jobsToCleaners).values({
        jobId: job.id,
        cleanerId: backup.cleanerId,
        role: "backup",
      });
    }

    await tx
      .update(jobs)
      .set({ status: "assigned", updatedAt: new Date() })
      .where(eq(jobs.id, job.id));
  });

  await notifyAssignedPrimary(
    job.id,
    primary.cleanerId,
    job.propertyId,
    job.checkInTime
  );

  return {
    jobId: job.id,
    status: "assigned",
    primaryCleanerId: primary.cleanerId,
    backupCleanerId: backup?.cleanerId ?? null,
  };
}

/**
 * In-repo replacement for the former `job-assignment-engine` Supabase edge
 * function. Assigns every upcoming unassigned job. Fire-and-forget safe.
 */
export async function runAssignmentEngine(): Promise<AssignmentSummary> {
  const summary: AssignmentSummary = {
    assigned: 0,
    skipped: 0,
    errors: [],
    outcomes: [],
  };

  const unassigned = await db.query.jobs.findMany({
    where: and(eq(jobs.status, "unassigned"), gt(jobs.checkInTime, new Date())),
    columns: { id: true, propertyId: true, checkInTime: true },
  });

  for (const job of unassigned) {
    try {
      const outcome = await assignJob(job);
      summary.outcomes.push(outcome);
      if (outcome.status === "assigned") summary.assigned += 1;
      else summary.skipped += 1;
    } catch (err) {
      summary.errors.push({
        jobId: job.id,
        error: err instanceof Error ? err.message : "assignment failed",
      });
    }
  }

  return summary;
}
