import "server-only";
import { db } from "@/db";
import { cleaners, propertyCleaners } from "@/db/schemas";
import type { PropertyCleanerTier } from "@/db/schemas";
import { getAvailableCleanersForProperty } from "@/lib/queries/cleaners-proximity";
import { eq } from "drizzle-orm";

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

export type Candidate = {
  cleanerId: string;
  score: number;
  /** roster candidates come first (respect the property hierarchy). */
  source: "roster" | "proximity";
  tier?: PropertyCleanerTier;
  /** Hot-tub-capable flag, used by the required-skills gate. */
  hotTubCapable: boolean;
  /** Laundry-lead eligible — preferred for the off-site Laundry Lead role. */
  laundryLeadCapable: boolean;
  /** Read for residential jobs only; defaults true on every row. */
  residentialQualified: boolean;
  /** Applied only when the job's property allows pets. */
  petComfortable: boolean;
};

/**
 * Narrows the candidate pool for residential jobs only.
 *
 * Returns null for a vacation-rental job, and that is load-bearing: no new code
 * path may change how a subscription-shaped job behaves. Null is not "a filter
 * that happens to pass everything" — it is no filter at all, which is what lets
 * the VR pool be compared cleaner-for-cleaner before and after.
 */
export type ResidentialFilter = {
  requirePetComfortable: boolean;
} | null;

/** Property hierarchy roster, tier-then-sortOrder ordered, eligibility resolved. */
async function getPropertyRosterCandidates(
  propertyId: string,
): Promise<Candidate[]> {
  const roster = await db
    .select({
      cleanerId: propertyCleaners.cleanerId,
      tier: propertyCleaners.tier,
      sortOrder: propertyCleaners.sortOrder,
      reliabilityScore: cleaners.reliabilityScore,
      eligibleForAssignments: cleaners.eligibleForAssignments,
      hasHotTubCert: cleaners.hasHotTubCert,
      hasLaundryLeadCert: cleaners.hasLaundryLeadCert,
      residentialQualified: cleaners.residentialQualified,
      petComfortable: cleaners.petComfortable,
    })
    .from(propertyCleaners)
    .innerJoin(cleaners, eq(propertyCleaners.cleanerId, cleaners.id))
    .where(eq(propertyCleaners.propertyId, propertyId));

  return roster
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
      hotTubCapable: r.hasHotTubCert ?? false,
      laundryLeadCapable: r.hasLaundryLeadCert ?? false,
      // Both columns are NOT NULL defaulting true — opt-out, not opt-in.
      // Defaulting false would ship residential with an empty assignable pool,
      // which reads as a broken engine rather than a policy. The `?? true`
      // covers a row read before 0041 is applied.
      residentialQualified: r.residentialQualified ?? true,
      petComfortable: r.petComfortable ?? true,
    }));
}

/**
 * Build the ordered candidate list for a job: the property hierarchy first,
 * then the proximity/reliability ranked pool for anyone not already listed.
 *
 * Exported so the assignment verifier can build both pools and compare them
 * cleaner-for-cleaner. Asserting through assignJob's outcome would only show
 * that *some* cleaner was picked, not that the ordering is unchanged.
 */
export async function buildCandidates(
  propertyId: string,
  residentialFilter: ResidentialFilter = null,
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
        hotTubCapable: c.hasHotTubCert,
        laundryLeadCapable: c.hasLaundryLeadCert,
        residentialQualified: c.residentialQualified,
        petComfortable: c.petComfortable,
      }));
  } catch (err) {
    // Property not geocoded / no coords — roster-only assignment still works.
    console.warn(
      `[assignment-engine] proximity ranking failed for property ${propertyId}:`,
      err instanceof Error ? err.message : err,
    );
  }

  const pool = [...rosterCandidates, ...proximity];

  // Residential jobs have no property roster, so rosterCandidates is empty and
  // the proximity pool supplies everyone. Expected, not a bug to work around.
  if (!residentialFilter) return pool;

  // The residential ordering, mapped onto what exists rather than rebuilt:
  // available/active is isCleanerAssignmentEligible, service area and distance
  // belong to the proximity ranker, reliability is the engine's gate and the
  // distance tie-break. Only these two flags are new.
  //
  // Experience is deliberately not a comparator: the ranker is shared with
  // vacation rental, so adding one would reorder the VR pool.
  return pool;
}

