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
import { notifyAdmins } from "@/lib/queries/admin-notifications";
import {
  PETS_CLEANER_NOTE,
  SERVICE_TYPE_LABELS,
} from "@/lib/constants/service-type";
import { appendJobNote } from "@/lib/jobs/job-notes";
import { and, eq, gt, inArray } from "drizzle-orm";

/** Best-effort multichannel notify of a newly-assigned primary cleaner. */
async function notifyAssignedPrimary(
  jobId: string,
  cleanerId: string,
  propertyId: string,
  checkInTime: Date | null,
  serviceType?: string | null
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
          columns: { address: true, petsAllowed: true },
        })
    );
    const address = property?.address ?? "your assigned property";
    const jobDate = checkInTime
      ? checkInTime.toLocaleString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
          timeZone: "America/New_York",
        })
      : "soon";

    // Two additions to this message and nothing else: the service type, so a
    // cleaner knows whether they are walking into a turnover or somebody's
    // home, and the pets note. The pets string comes from the shared constant —
    // do not paraphrase it and do not make a second copy.
    const kind =
      serviceType === "residential_one_time"
        ? SERVICE_TYPE_LABELS.residential_one_time
        : SERVICE_TYPE_LABELS.vacation_rental_subscription;
    const petLine = property?.petsAllowed ? ` ${PETS_CLEANER_NOTE}` : "";

    await notifyCleaner({
      cleanerId,
      type: "assignment",
      title: "New job assigned",
      message: `You've been assigned a ${kind} at ${address} on ${jobDate}.${petLine}`,
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
 * Reliability eligibility gate (0–100), from the functionality spec: below
 * 80 a cleaner is flagged and never auto-assigned. Above the gate, ranking is
 * distance-first, and the Team Leader is the most reliable of the
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
type ResidentialFilter = {
  requirePetComfortable: boolean;
} | null;

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
      residentialQualified: cleaners.residentialQualified,
      petComfortable: cleaners.petComfortable,
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
  residentialFilter: ResidentialFilter = null
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
      err instanceof Error ? err.message : err
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
  return pool.filter((c) => {
    if (!c.residentialQualified) return false;
    if (residentialFilter.requirePetComfortable && !c.petComfortable) {
      return false;
    }
    return true;
  });
}

/** Assign one job. Idempotent: safe to re-run (re-selects primary/backup). */
export async function assignJob(job: {
  id: string;
  propertyId: string | null;
  checkInTime: Date | null;
  /** Used to size this job's window when checking for schedule clashes. */
  expectedHours?: string | number | null;
  /** 0041. Residential jobs narrow the pool; a VR job must not be narrowed. */
  serviceType?: string | null;
  /** Drives the required-skills gate + team size. Read from the job's snapshot. */
  addonsSnapshot?: {
    hotTubServiceLevel?: string | null;
    teamSize?: number | null;
    laundryType?: string | null;
    petsAllowed?: boolean | null;
  } | null;
}): Promise<AssignmentOutcome> {
  if (!job.propertyId || !job.checkInTime) {
    return { jobId: job.id, status: "skipped", reason: "missing property or check-in time" };
  }

  // Pets read from the job's snapshot, not live from the property: the snapshot
  // is what this job was priced and staffed on, so matching the cleaner to it
  // keeps assignment consistent with the money. A property whose flag is edited
  // later must not silently re-pool an assigned clean. The cleaner-facing note
  // reads live, which is a different question.
  const residentialFilter: ResidentialFilter =
    job.serviceType === "residential_one_time"
      ? { requirePetComfortable: job.addonsSnapshot?.petsAllowed === true }
      : null;

  const candidates = await buildCandidates(job.propertyId, residentialFilter);

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
    // Naming the reason matters: "nobody is residential-qualified" is a
    // different operational fix from "everyone is already working that day".
    if (residentialFilter && candidates.length === 0) {
      return {
        jobId: job.id,
        status: "skipped",
        reason: residentialFilter.requirePetComfortable
          ? "no residential-qualified, pet-comfortable cleaner"
          : "no residential-qualified cleaner",
      };
    }
    return { jobId: job.id, status: "skipped", reason: "no eligible cleaner" };
  }

  // Step 2, required-skills gate. A hot-tub clean must be worked by a
  // hot-tub-capable cleaner. We filter the whole pool — not just the primary —
  // so a backup elevated into the job is capable too. "At least one
  // hot-tub-capable cleaner must be assigned" has to hold after a swap.
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

  // Team Leader = highest reliability on the team. No extra pay.
  const leader = team.reduce(
    (best, c) => (c.score > best.score ? c : best),
    team[0]
  );

  // Off-site laundry: exactly one team member is the Laundry Lead ($5/load),
  // preferring a laundry-lead-eligible cleaner, else the leader.
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

  // Notify every working team member — one at a time. `notifyAssignedPrimary`
  // issues DB reads, so a `Promise.all` here pipelines them onto one pooler
  // connection, which answers the first and silently drops the rest.
  // It has been invisible because a team of 1 fans out to nothing; residential
  // large homes and off-site VR jobs staff two. Same shape as.
  for (const member of team) {
    await notifyAssignedPrimary(
      job.id,
      member.cleanerId,
      job.propertyId!,
      job.checkInTime,
      job.serviceType
    );
  }

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
      serviceType: true,
      // Read so the admin-review notification below can be emitted once per
      // job rather than on every cron run.
      notes: true,
    },
    /**
     * **Vacation rental wins contention (Phase 2 Scope, item 3).**
     *
     * This is the entire mechanism, and it is worth saying plainly because the
     * next reader will go looking for something more elaborate: there is no
     * scoring, no priority column and no second pass. Jobs are simply offered
     * cleaners in this order, so a vacation-rental job claims a contended
     * cleaner first and the residential job that wanted them finds the pool one
     * shorter — and is skipped with a reason if that empties it.
     *
     * Previously this was unordered, i.e. whatever order Postgres happened to
     * return, which meant contention was resolved by luck.
     */
    orderBy: (table, { asc, sql: order }) => [
      order`(${table.serviceType} = 'vacation_rental_subscription') desc`,
      asc(table.checkInTime),
    ],
  });

  for (const job of unassigned) {
    try {
      const outcome = await assignJob(job);
      summary.outcomes.push(outcome);
      if (outcome.status === "assigned") {
        summary.assigned += 1;
      } else {
        summary.skipped += 1;
        await escalateSkippedResidentialJob(job, outcome.reason);
      }
    } catch (err) {
      summary.errors.push({
        jobId: job.id,
        error: err instanceof Error ? err.message : "assignment failed",
      });
    }
  }

  return summary;
}

/**
 *: a residential job the engine cannot staff goes to **admin review**.
 *
 * Deliberately not a new job status. A "pending
 * review" status would need a new `job_status` enum value consumed by the admin
 * dashboard, the cleaner portal and the native app, or a filter every future
 * query has to remember. The job stays `unassigned`, which every surface
 * already understands and which M4 made filterable by service type; what it
 * gains is a note saying why, and one notification to admins.
 *
 * **Emitted once per job, not once per cron run.** `runAssignmentEngine` is on a
 * schedule, so an unstaffable job would otherwise notify every admin on every
 * pass until someone fixed it — which trains admins to ignore the bell. The
 * note is the idempotency key.
 *
 * Best-effort by contract: a notification that cannot be written must not fail
 * an assignment run, and must not land in `summary.errors`, which is this
 * milestone's evidence that nothing threw.
 */
const ADMIN_REVIEW_NOTE_MARKER = "[System] Needs admin review:";

async function escalateSkippedResidentialJob(
  job: { id: string; serviceType?: string | null; notes?: string | null },
  reason: string
): Promise<void> {
  if (job.serviceType !== "residential_one_time") return;
  if (job.notes?.includes(ADMIN_REVIEW_NOTE_MARKER)) return;

  try {
    await db
      .update(jobs)
      .set({
        notes: appendJobNote(
          job.notes ?? null,
          `${ADMIN_REVIEW_NOTE_MARKER} the assignment engine could not staff this clean (${reason}).`
        ),
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, job.id));

    await notifyAdmins({
      type: "assignment",
      title: "Residential clean needs assignment",
      message: `A one-time residential clean could not be staffed automatically (${reason}). Assign a cleaner by hand.`,
      jobId: job.id,
      url: `/admin/job-oversight/${job.id}`,
      // The one trigger in 2A that also goes by email (M6, F-11). The clean is
      // paid for and has a date; an in-app row nobody happens to be looking at
      // is not an alert for that. M6 named two time-sensitive triggers — the
      // other was "residential request under 48h needs review", which the
      // deleted along with the review queue, so this is the whole list.
      //
      // It stays once-per-job: the note marker above is the idempotency key, so
      // the cron cannot mail admins on every pass.
      email: true,
    });
  } catch (err) {
    console.error(
      `[assignment-engine] admin-review escalation failed for job ${job.id}:`,
      err
    );
  }
}
