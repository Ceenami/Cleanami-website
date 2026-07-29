import "server-only";

import { db } from "@/db";
import { availability, cleaners, jobs, propertyCleaners } from "@/db/schemas";
import type { PropertyCleanerTier } from "@/db/schemas";
import { isCleanerAssignmentEligible } from "@/lib/cleaner/eligibility";
import { getAvailableCleanersForJob } from "@/lib/queries/cleaners-proximity";
import { hasScheduleConflict } from "@/lib/services/assignment/schedule-conflict";
import { toEasternDateString } from "@/lib/time/eastern";
import { eq } from "drizzle-orm";

/**
 * Matches RELIABILITY_MIN_ELIGIBLE in the assignment engine: a cleaner who is
 * not reliable enough to be auto-assigned is not reliable enough to take over
 * someone else's clean either.
 */
const RELIABILITY_MIN_ELIGIBLE = 80;

/** How many cleaners a single swap is broadcast to. */
export const SWAP_NOTIFY_LIMIT = 5;

const TIER_PRIORITY: Record<PropertyCleanerTier, number> = {
  main_primary: 0,
  secondary_primary: 1,
  preferred_backup: 2,
  on_call: 3,
};

type Candidate = {
  cleanerId: string;
  fullName: string;
  reliability: number;
  hotTubCapable: boolean;
};

export type SwapCandidateResult = {
  /** Ordered: the property's own roster by tier, then nearest-first. */
  candidates: Candidate[];
  /** Set only when `candidates` is empty — the most specific reason available. */
  emptyReason: string | null;
};

/** Missing score means a brand-new cleaner with no reliability events yet. */
function scoreOf(reliabilityScore: string | number | null): number {
  const n = parseFloat(String(reliabilityScore ?? "100"));
  return Number.isFinite(n) ? n : 100;
}

/**
 * A hot-tub property needs a hot-tub-capable cleaner on the job, so a swap may
 * only hand the clean to someone who can service it.
 */
function jobRequiresHotTub(
  addonsSnapshot: { hotTubServiceLevel?: string | null } | null | undefined
): boolean {
  const level = addonsSnapshot?.hotTubServiceLevel;
  return !!level && level !== "none";
}

/**
 * Who may take over a clean, per the swap rules: a cleaner who has submitted
 * availability for that day, has no conflicting assignment, and meets the job's
 * requirements.
 *
 * The property's designated roster is offered first, then the proximity-ranked
 * pool, mirroring how the assignment engine and urgent replacement both order
 * candidates.
 *
 * Note the 3-per-60-days ceiling is deliberately *not* applied here — it caps
 * how often a cleaner may hand work away, not how often they may pick it up.
 */
export async function getSwapCandidates(
  jobId: string,
  originalCleanerId: string,
  options?: { limit?: number }
): Promise<SwapCandidateResult> {
  const limit = options?.limit ?? SWAP_NOTIFY_LIMIT;

  const job = await db.query.jobs.findFirst({
    where: eq(jobs.id, jobId),
    columns: {
      id: true,
      propertyId: true,
      checkInTime: true,
      expectedHours: true,
      addonsSnapshot: true,
    },
    with: { cleaners: { columns: { cleanerId: true } } },
  });

  if (!job?.checkInTime || !job.propertyId) {
    return { candidates: [], emptyReason: "This job has no scheduled start time yet." };
  }

  // Anyone already on the job cannot also be the replacement.
  const excluded = new Set<string>([
    originalCleanerId,
    ...job.cleaners.map((c) => c.cleanerId),
  ]);

  const availableOnDay = await db
    .select({ cleanerId: availability.cleanerId })
    .from(availability)
    .where(eq(availability.date, toEasternDateString(job.checkInTime)));
  const submittedAvailability = new Set(availableOnDay.map((a) => a.cleanerId));

  // A cleaner must have said they can work that day. When *nobody* submitted
  // for the date the rota simply has no data for it, and gating on it would
  // refuse every swap for a reason that has nothing to do with who is free —
  // so fall back to the same pool the assignment engine draws from.
  const enforceAvailability = submittedAvailability.size > 0;

  const pool = await buildOrderedPool(jobId, job.propertyId, excluded);
  if (pool.length === 0) {
    return { candidates: [], emptyReason: "No other cleaners are set up for assignments right now." };
  }

  const needsHotTub = jobRequiresHotTub(job.addonsSnapshot);
  const rejected = { reliability: 0, availability: 0, hotTub: 0, conflict: 0 };
  const candidates: Candidate[] = [];

  for (const candidate of pool) {
    if (candidates.length >= limit) break;

    if (candidate.reliability < RELIABILITY_MIN_ELIGIBLE) {
      rejected.reliability += 1;
      continue;
    }
    if (enforceAvailability && !submittedAvailability.has(candidate.cleanerId)) {
      rejected.availability += 1;
      continue;
    }
    if (needsHotTub && !candidate.hotTubCapable) {
      rejected.hotTub += 1;
      continue;
    }
    if (
      await hasScheduleConflict({
        cleanerId: candidate.cleanerId,
        checkInTime: job.checkInTime,
        expectedHours: job.expectedHours,
        excludeJobId: jobId,
      })
    ) {
      rejected.conflict += 1;
      continue;
    }

    candidates.push(candidate);
  }

  return {
    candidates,
    emptyReason: candidates.length > 0 ? null : describeRejections(rejected),
  };
}

/** True when this one cleaner may take over the clean. */
export async function canCleanerCoverSwap(
  cleanerId: string,
  jobId: string,
  originalCleanerId: string
): Promise<boolean> {
  // Ask for the whole pool rather than a short list: the cleaner checking may
  // rank below the broadcast cut-off yet still be a legitimate taker if the
  // cleaners ahead of them have not claimed it.
  const { candidates } = await getSwapCandidates(jobId, originalCleanerId, {
    limit: Number.MAX_SAFE_INTEGER,
  });
  return candidates.some((c) => c.cleanerId === cleanerId);
}

/** Property roster by tier, then the proximity-ranked pool for everyone else. */
async function buildOrderedPool(
  jobId: string,
  propertyId: string,
  excluded: Set<string>
): Promise<Candidate[]> {
  const roster = await db
    .select({
      cleanerId: propertyCleaners.cleanerId,
      fullName: cleaners.fullName,
      tier: propertyCleaners.tier,
      sortOrder: propertyCleaners.sortOrder,
      reliabilityScore: cleaners.reliabilityScore,
      hasHotTubCert: cleaners.hasHotTubCert,
      accountStatus: cleaners.accountStatus,
      onboardingCompleted: cleaners.onboardingCompleted,
      onboardingStarted: cleaners.onboardingStarted,
      stripePayoutsEnabled: cleaners.stripePayoutsEnabled,
      stripeChargesEnabled: cleaners.stripeChargesEnabled,
      stripeOnboardingComplete: cleaners.stripeOnboardingComplete,
      eligibleForAssignments: cleaners.eligibleForAssignments,
    })
    .from(propertyCleaners)
    .innerJoin(cleaners, eq(propertyCleaners.cleanerId, cleaners.id))
    .where(eq(propertyCleaners.propertyId, propertyId));

  const seen = new Set<string>();
  const ordered: Candidate[] = [];

  const add = (candidate: Candidate) => {
    if (excluded.has(candidate.cleanerId) || seen.has(candidate.cleanerId)) return;
    seen.add(candidate.cleanerId);
    ordered.push(candidate);
  };

  roster
    .filter((r) => isCleanerAssignmentEligible(r))
    .sort((a, b) => {
      const ta = TIER_PRIORITY[a.tier as PropertyCleanerTier];
      const tb = TIER_PRIORITY[b.tier as PropertyCleanerTier];
      return ta !== tb ? ta - tb : a.sortOrder - b.sortOrder;
    })
    .forEach((r) =>
      add({
        cleanerId: r.cleanerId,
        fullName: r.fullName,
        reliability: scoreOf(r.reliabilityScore),
        hotTubCapable: r.hasHotTubCert ?? false,
      })
    );

  try {
    const { cleaners: nearby } = await getAvailableCleanersForJob(jobId, {
      includeOnJob: false,
    });
    for (const c of nearby) {
      add({
        cleanerId: c.id,
        fullName: c.fullName,
        reliability: scoreOf(c.reliabilityScore),
        hotTubCapable: c.hasHotTubCert,
      });
    }
  } catch (err) {
    // Property not geocoded — the roster alone can still cover the swap.
    console.warn(
      `[swap-candidates] proximity ranking failed for job ${jobId}:`,
      err instanceof Error ? err.message : err
    );
  }

  return ordered;
}

/** Turn the rejection tally into the single most useful sentence. */
function describeRejections(rejected: {
  reliability: number;
  availability: number;
  hotTub: number;
  conflict: number;
}): string {
  if (rejected.hotTub > 0) {
    return "No hot-tub-capable cleaner is free for this clean.";
  }
  if (rejected.conflict > 0) {
    return "Every available cleaner is already booked at this time.";
  }
  if (rejected.availability > 0) {
    return "No other cleaner has submitted availability for that day.";
  }
  if (rejected.reliability > 0) {
    return "No cleaner with a high enough reliability score is free for this clean.";
  }
  return "No eligible cleaners are available for a swap right now.";
}
