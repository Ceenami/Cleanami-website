import "server-only";

import { db, sequentialQueries } from "@/db";
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
import { hasScheduleConflict } from "@/lib/services/assignment/schedule-conflict";
import { and, eq, gt, inArray } from "drizzle-orm";

/** Best-effort multichannel notify of a newly-assigned primary cleaner. */
async function notifyAssignedPrimary(
  jobId: string,
  cleanerId: string,
  propertyId: string,
  checkInTime: Date | null
): Promise<void> {
  try {
    // Sequential, not `Promise.all` — see `sequentialQueries` in db/index.ts.
    const [cleaner, property] = await sequentialQueries(
      () =>
        db.query.cleaners.findFirst({
          where: eq(cleaners.id, cleanerId),
          columns: { fullName: true, email: true },
        }),
      () =>
        db.query.properties.findFirst({
          where: eq(properties.id, propertyId),
          columns: { address: true },
        })
    );
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
 * Reliability eligibility gate (0–100), from the functionality spec §13: below
 * 80 a cleaner is flagged and never auto-assigned. Above the gate, ranking is
 * distance-first (spec §13.4) and the Team Leader is the most reliable of the
 * assigned team.
 */
const RELIABILITY_MIN_ELIGIBLE = 80;

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
  /** Hot-tub-capable flag — used by the required-skills gate (spec §4/§280). */
  hotTubCapable: boolean;
  /** Laundry-lead eligible — preferred for the off-site Laundry Lead role. */
  laundryLeadCapable: boolean;
};

/**
 * Whether this job requires a hot-tub-capable cleaner. The iCal service writes
 * `hotTubServiceLevel` as "basic"/"deep_clean" for hot-tub properties and the
 * literal "none" otherwise, so a truthy, non-"none" value means hot tub applies.
 */
function jobRequiresHotTub(
  addonsSnapshot: { hotTubServiceLevel?: string | null } | null | undefined
): boolean {
  const level = addonsSnapshot?.hotTubServiceLevel;
  return !!level && level !== "none";
}

export type AssignmentOutcome =
  | { jobId: string; status: "assigned"; primaryCleanerId: string; backupCleanerId: string | null }
  | { jobId: string; status: "skipped"; reason: string };

export type AssignmentSummary = {
  assigned: number;
  skipped: number;
  errors: Array<{ jobId: string; error: string }>;
  outcomes: AssignmentOutcome[];
};

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
      hasHotTubCert: cleaners.hasHotTubCert,
      hasLaundryLeadCert: cleaners.hasLaundryLeadCert,
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
      hotTubCapable: r.hasHotTubCert ?? false,
      laundryLeadCapable: r.hasLaundryLeadCert ?? false,
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
        hotTubCapable: c.hasHotTubCert,
        laundryLeadCapable: c.hasLaundryLeadCert,
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
  /** Used to size this job's window when checking for schedule clashes. */
  expectedHours?: string | number | null;
  /** Drives the required-skills gate + team size. Read from the job's snapshot. */
  addonsSnapshot?: {
    hotTubServiceLevel?: string | null;
    teamSize?: number | null;
    laundryType?: string | null;
  } | null;
}): Promise<AssignmentOutcome> {
  if (!job.propertyId || !job.checkInTime) {
    return { jobId: job.id, status: "skipped", reason: "missing property or check-in time" };
  }

  const candidates = await buildCandidates(job.propertyId);

  // Filter to reliability-eligible candidates with no schedule clash.
  const eligible: Candidate[] = [];
  for (const c of candidates) {
    if (c.score < RELIABILITY_MIN_ELIGIBLE) continue;
    if (
      await hasScheduleConflict({
        cleanerId: c.cleanerId,
        checkInTime: job.checkInTime,
        expectedHours: job.expectedHours,
        excludeJobId: job.id,
      })
    )
      continue;
    eligible.push(c);
  }

  if (eligible.length === 0) {
    return { jobId: job.id, status: "skipped", reason: "no eligible cleaner" };
  }

  // Step 2 required-skills gate (spec §4). A hot-tub clean must be worked by a
  // hot-tub-capable cleaner. We filter the whole pool — not just the primary —
  // so a backup elevated into the job is capable too; §280's "at least one
  // hot-tub-capable cleaner must be assigned" has to still hold after a swap.
  let pool = eligible;
  if (jobRequiresHotTub(job.addonsSnapshot)) {
    const capable = eligible.filter((c) => c.hotTubCapable);
    if (capable.length === 0) {
      // Available cleaners exist, but none is hot-tub-capable — distinct from a
      // plain starvation skip so an admin knows to certify or hand-assign one.
      return {
        jobId: job.id,
        status: "skipped",
        reason: "no hot-tub-capable cleaner available",
      };
    }
    pool = capable;
  }

  // Team size from the job's staffing snapshot (v12). The pool is ordered
  // roster-tier-first then nearest, so the working team is the top N candidates;
  // clamp to what is actually available rather than failing to staff.
  const desiredTeamSize = Math.max(1, job.addonsSnapshot?.teamSize ?? 1);
  const teamSize = Math.min(desiredTeamSize, pool.length);
  const team = pool.slice(0, teamSize);

  // Team Leader = highest reliability on the team (spec §3). No extra pay.
  const leader = team.reduce(
    (best, c) => (c.score > best.score ? c : best),
    team[0]
  );

  // Off-site laundry: exactly one team member is the Laundry Lead ($5/load,
  // spec §3/§8), preferring a laundry-lead-eligible cleaner, else the leader.
  const isOffSite = job.addonsSnapshot?.laundryType === "off_site";
  const laundryLead = isOffSite
    ? team.find((c) => c.laundryLeadCapable) ?? leader
    : null;

  // One backup from the next-ranked candidate outside the team (shadow — not paid
  // unless promoted in). May be absent on a thin pool.
  const backup = pool[teamSize] ?? null;

  await db.transaction(async (tx) => {
    // Clear any prior auto-assignment for these roles (idempotent re-run).
    await tx
      .delete(jobsToCleaners)
      .where(
        and(
          eq(jobsToCleaners.jobId, job.id),
          inArray(jobsToCleaners.role, ["primary", "laundry_lead", "backup"])
        )
      );

    for (const member of team) {
      const isLaundryLead = laundryLead?.cleanerId === member.cleanerId;
      await tx.insert(jobsToCleaners).values({
        jobId: job.id,
        cleanerId: member.cleanerId,
        role: isLaundryLead ? "laundry_lead" : "primary",
        isTeamLeader: member.cleanerId === leader.cleanerId,
      });
    }

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

  // Notify every working team member.
  await Promise.all(
    team.map((member) =>
      notifyAssignedPrimary(
        job.id,
        member.cleanerId,
        job.propertyId!,
        job.checkInTime
      )
    )
  );

  return {
    jobId: job.id,
    status: "assigned",
    primaryCleanerId: leader.cleanerId,
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
    columns: {
      id: true,
      propertyId: true,
      checkInTime: true,
      expectedHours: true,
      addonsSnapshot: true,
    },
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
