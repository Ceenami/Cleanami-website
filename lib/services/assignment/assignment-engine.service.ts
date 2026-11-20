import "server-only";

import { db, sequentialQueries } from "@/db";
import {
  cleaners,
  jobs,
  jobsToCleaners,
  properties,
  propertyExclusions,
  assignmentRuns,
  availability,
} from "@/db/schemas";
import { notifyCleaner } from "@/lib/services/notifications/notify";
import { sendCleanerAssignmentEmail } from "@/lib/services/email.service";
import { hasScheduleConflict } from "@/lib/services/assignment/schedule-conflict";
import { filterCandidatesBySubmittedAvailability } from "@/lib/services/assignment/submitted-availability";
import { notifyAdmins } from "@/lib/queries/admin-notifications";
import {
  PETS_CLEANER_NOTE,
  SERVICE_TYPE_LABELS,
  getJobDisplay,
} from "@/lib/constants/service-type";
import { appendJobNote } from "@/lib/jobs/job-notes";
import { assignmentReasons, selectCompleteTeam } from "./policy";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { buildCandidates, type Candidate, type ResidentialFilter } from "./candidates.service";
export { buildCandidates } from "./candidates.service";
import { pairQualifiedBackups } from "./offer-policy";
import { offerEnrollmentEnabled, enrollOfferJob, createBackupOffer, dispatchJobOffers, isOfferJob } from "./offers.service";
import { canAssignPriorityFallback, planPropertyPriority } from "./priority.service";
import { priorityEnrollmentEnabled } from "./priority-settings";

class AssignmentCommitError extends Error {
  constructor(
    message: string,
    readonly candidates: Array<{
      cleanerId: string;
      source: string;
      reasons: string[];
      selected: boolean;
      selectedRole?: string | null;
    }>,
    readonly context: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AssignmentCommitError";
  }
}

/** Best-effort multichannel notify of a newly-assigned primary cleaner. */
async function notifyAssignedPrimary(
  jobId: string,
  cleanerId: string,
  propertyId: string,
  checkInTime: Date | null,
  serviceType?: string | null,
  serviceLabel?: string,
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
        }),
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
      serviceLabel ??
      (serviceType === "residential_one_time"
        ? SERVICE_TYPE_LABELS.residential_one_time
        : SERVICE_TYPE_LABELS.vacation_rental_subscription);
    const petLine = property?.petsAllowed ? ` ${PETS_CLEANER_NOTE}` : "";

    try {
      await notifyCleaner({
        cleanerId,
        type: "assignment",
        title: "New job assigned",
        message: `You've been assigned a ${kind} at ${address} on ${jobDate}.${petLine}`,
        jobId,
        url: `/cleaner/jobs/${jobId}`,
      });
    } catch (error) {
      console.error("[assignment-engine] cleaner channels failed; attempting email independently", error);
    }

    if (cleaner?.email) {
      await sendCleanerAssignmentEmail({
        to: cleaner.email,
        name: cleaner.fullName,
        propertyAddress: address,
        jobDate,
        jobId,
        serviceLabel: kind,
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

/**
 * Whether this job requires a hot-tub-capable cleaner. The iCal service writes
 * `hotTubServiceLevel` as "basic"/"deep_clean" for hot-tub properties and the
 * literal "none" otherwise, so a truthy, non-"none" value means hot tub applies.
 */
function jobRequiresHotTub(
  addonsSnapshot: { hotTubServiceLevel?: string | null } | null | undefined,
): boolean {
  const level = addonsSnapshot?.hotTubServiceLevel;
  return !!level && level !== "none";
}

export type AssignmentOutcome =
  | {
      jobId: string;
      status: "assigned";
      primaryCleanerId: string;
      backupCleanerId: string | null;
      backupCleanerIds?: string[];
    }
  | { jobId: string; status: "skipped"; reason: string };

export type AssignmentSummary = {
  assigned: number;
  skipped: number;
  errors: Array<{ jobId: string; error: string }>;
  outcomes: AssignmentOutcome[];
};

/** Assign one job. Idempotent: safe to re-run (re-selects primary/backup). */
export async function assignJob(job: {
  id: string;
  propertyId: string | null;
  checkInTime: Date | null;
  checkOutTime?: Date | null;
  /** Used to size this job's window when checking for schedule clashes. */
  expectedHours?: string | number | null;
  /** Residential qualification does not narrow a rental job's pool. */
  serviceType?: string | null;
  jobLabel?: string | null;
  /** Drives the required-skills gate + team size. Read from the job's snapshot. */
  addonsSnapshot?: {
    cleaningLevel?: unknown;
    hotTubServiceLevel?: string | null;
    teamSize?: number | null;
    laundryType?: string | null;
    petsAllowed?: boolean | null;
    requiresManualStaffing?: boolean;
  } | null;
  checklistSnapshot?: {
    capabilityRequirements?: { hotTub: boolean; laundryLead: boolean };
  } | null;
}): Promise<AssignmentOutcome> {
  if (!job.propertyId || !job.checkInTime) {
    return {
      jobId: job.id,
      status: "skipped",
      reason: "missing property or check-in time",
    };
  }

  const priorityPlan = await planPropertyPriority(job.id);
  if (priorityPlan) return { jobId: job.id, status: "skipped", reason: "property_priority_replacement_pending" };
  if (await isOfferJob(job.id)) {
    // Priority review may enroll an empty target before a move proves impossible.
    // Ordinary fallback can still cover it; never overwrite a membership, offer or plan.
    const emptyPriorityTarget = await canAssignPriorityFallback(job.id);
    if (!emptyPriorityTarget)
      return { jobId: job.id, status: "skipped", reason: "versioned_job_needs_coverage_review" };
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
  const date = job.checkInTime.toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
  const preferences = await db.query.availability.findMany({
    where: eq(availability.date, date),
    columns: { cleanerId: true, onCallEligible: true, openPoolEligible: true },
  });
  const preferenceByCleaner = new Map(preferences.map((p) => [p.cleanerId, p]));
  const profiles = await db.query.cleaners.findMany();
  const exclusions = await db
    .select()
    .from(propertyExclusions)
    .where(eq(propertyExclusions.propertyId, job.propertyId));
  const excluded = new Set(exclusions.map((row) => row.cleanerId));
  const candidateAudit = profiles
    .map((profile) => ({
      cleanerId: profile.id,
      source:
        candidates.find((c) => c.cleanerId === profile.id)?.tier ??
        (preferenceByCleaner.get(profile.id)?.onCallEligible
          ? "on_call"
          : preferenceByCleaner.get(profile.id)?.openPoolEligible
            ? "open_pool"
            : candidates.some((c) => c.cleanerId === profile.id)
              ? "proximity"
              : "outside_proximity_pool"),
      reasons: [
        ...assignmentReasons(profile, job, excluded.has(profile.id)),
        ...(candidates.some((c) => c.cleanerId === profile.id)
          ? []
          : ["outside_proximity_pool"]),
      ],
      selected: false,
      selectedRole: null as string | null,
    }))
    .sort(
      (a, b) =>
        (candidates.findIndex((c) => c.cleanerId === a.cleanerId) < 0
          ? Infinity
          : candidates.findIndex((c) => c.cleanerId === a.cleanerId)) -
        (candidates.findIndex((c) => c.cleanerId === b.cleanerId) < 0
          ? Infinity
          : candidates.findIndex((c) => c.cleanerId === b.cleanerId)),
    );
  async function recordSkipped(reason: string): Promise<AssignmentOutcome> {
    await db.insert(assignmentRuns).values({
      jobId: job.id,
      outcome: "skipped",
      reason,
      candidates: candidateAudit.slice(0, 500),
      actorId: "assignment-engine",
      context: {
        scheduledAt: job.checkInTime?.toISOString(),
        teamSize: job.addonsSnapshot?.teamSize,
        evaluatedAt: new Date().toISOString(),
      },
    });
    return { jobId: job.id, status: "skipped", reason };
  }
  if (
    job.addonsSnapshot?.requiresManualStaffing ||
    job.addonsSnapshot?.teamSize === null
  )
    return recordSkipped("manual_staffing_required");
  const availabilityGate = await filterCandidatesBySubmittedAvailability(
    candidates,
    job.checkInTime,
  );

  // Filter to reliability-eligible candidates with no schedule clash.
  const eligible: Candidate[] = [];
  const availableIds = new Set(
    availabilityGate.candidates.map((c) => c.cleanerId),
  );
  for (const audit of candidateAudit) {
    if (!availableIds.has(audit.cleanerId))
      audit.reasons.push("no_acknowledged_available_date");
  }
  for (const c of availabilityGate.candidates) {
    const audit = candidateAudit.find((row) => row.cleanerId === c.cleanerId)!;
    const preference = preferenceByCleaner.get(c.cleanerId);
    if (
      (c.tier === "on_call" && !preference?.onCallEligible) ||
      (job.serviceType !== "residential_one_time" &&
        c.source === "proximity" &&
        !preference?.onCallEligible &&
        !preference?.openPoolEligible)
    )
      audit.reasons.push("not_opted_into_fallback_pool");
    if (c.score < RELIABILITY_MIN_ELIGIBLE)
      audit.reasons.push("reliability_below_80");
    if (audit.reasons.length) continue;
    if (offerEnrollmentEnabled()) {
      try { await db.execute(sql`select phase3a_assert_candidate(${job.id}::uuid,${c.cleanerId}::uuid,null::uuid,'primary')`); }
      catch { audit.reasons.push("offer_eligibility_or_standby_conflict"); continue; }
    }
    if (
      await hasScheduleConflict({
        cleanerId: c.cleanerId,
        checkInTime: job.checkInTime,
        expectedHours: job.expectedHours,
        excludeJobId: job.id,
      })
    ) {
      audit.reasons.push("schedule_conflict");
      continue;
    }
    eligible.push(c);
  }

  if (eligible.length === 0) {
    return recordSkipped("no_eligible_cleaner");
  }

  // Capability belongs to the whole team. Never silently shrink a quoted team.
  const pool = eligible;
  const desiredTeamSize = Math.max(1, job.addonsSnapshot?.teamSize ?? 1);
  const team = selectCompleteTeam(
    pool,
    desiredTeamSize,
    jobRequiresHotTub(job.addonsSnapshot) ||
      !!job.checklistSnapshot?.capabilityRequirements?.hotTub,
    job.addonsSnapshot?.laundryType === "off_site" ||
      !!job.checklistSnapshot?.capabilityRequirements?.laundryLead,
  );
  if (!team) return recordSkipped("insufficient_complete_qualified_team");
  const teamSize = team.length;

  // Team Leader = highest reliability on the team. No extra pay.
  const leader = team.reduce(
    (best, c) => (c.score > best.score ? c : best),
    team[0],
  );

  // Off-site laundry requires a qualified designated lead; no leader fallback.
  const isOffSite =
    job.addonsSnapshot?.laundryType === "off_site" ||
    !!job.checklistSnapshot?.capabilityRequirements?.laundryLead;
  const laundryLead = isOffSite
    ? team.find((c) => c.laundryLeadCapable)!
    : null;

  // One backup from the next-ranked candidate outside the team (shadow — not paid
  // unless promoted in). May be absent on a thin pool.
  const backup =
    pool.find((c) => !team.some((t) => t.cleanerId === c.cleanerId)) ?? null;
  const versioned = offerEnrollmentEnabled();
  const pairedBackups = versioned ? pairQualifiedBackups(team, pool, (candidate, worker) => {
    const replacement = team.map(member => member.cleanerId === worker.cleanerId ? candidate : member);
    return (!(jobRequiresHotTub(job.addonsSnapshot) || job.checklistSnapshot?.capabilityRequirements?.hotTub) || !worker.hotTubCapable || candidate.hotTubCapable) &&
      (!isOffSite || (worker.cleanerId !== laundryLead?.cleanerId || candidate.laundryLeadCapable)) &&
      (!(jobRequiresHotTub(job.addonsSnapshot) || job.checklistSnapshot?.capabilityRequirements?.hotTub) || replacement.some(c => c.hotTubCapable));
  }) : [];
  const backupIds = new Set(versioned ? pairedBackups.map(p => p.backup.cleanerId) : backup ? [backup.cleanerId] : []);
  const firstBackupId = [...backupIds][0] ?? null;

  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('cleannami.assignment_source','automatic',true)`,
      );
      const [claimed] = await tx
        .select()
        .from(jobs)
        .where(eq(jobs.id, job.id))
        .for("update");
      if (claimed?.status !== "unassigned")
        throw new Error("Job already claimed; reload assignments");
      if (versioned && (claimed.propertyId !== job.propertyId || claimed.checkInTime?.getTime() !== job.checkInTime?.getTime() || (job.checkOutTime !== undefined && claimed.checkOutTime?.getTime() !== job.checkOutTime?.getTime()) || String(claimed.expectedHours) !== String(job.expectedHours) || JSON.stringify(claimed.addonsSnapshot) !== JSON.stringify(job.addonsSnapshot) || JSON.stringify(claimed.checklistSnapshot) !== JSON.stringify(job.checklistSnapshot)))
        throw new Error("Assignment inputs changed; reload before issuing offers");
      if (versioned && priorityEnrollmentEnabled() && await isOfferJob(job.id, tx)) {
        if (!await canAssignPriorityFallback(job.id, tx)) throw new Error("Priority coverage changed; reload before fallback");
      }
      if (versioned) await enrollOfferJob(tx, job.id);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`property:${job.propertyId}`},0))`,
      );
      // Lock every working cleaner/date in stable order before trigger checks.
      const date = job.checkInTime!.toLocaleDateString("en-CA", {
        timeZone: "America/New_York",
      });
      for (const member of [...team, ...pairedBackups.map(p => p.backup)].sort((a, b) =>
        a.cleanerId.localeCompare(b.cleanerId),
      ))
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`cleaner:${member.cleanerId}:${date}`},0))`,
        );
      // Clear any prior auto-assignment for these roles (idempotent re-run).
      await tx
        .delete(jobsToCleaners)
        .where(
          and(
            eq(jobsToCleaners.jobId, job.id),
            inArray(jobsToCleaners.role, ["primary", "laundry_lead", "backup"]),
          ),
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

      if (versioned) {
        for (const pair of pairedBackups) {
          await tx.insert(jobsToCleaners).values({ jobId: job.id, cleanerId: pair.backup.cleanerId, role: "backup" });
          await createBackupOffer(tx, job.id, pair.backup.cleanerId, pair.worker.cleanerId);
        }
      } else if (backup) {
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
      for (const audit of candidateAudit) {
        audit.selected =
          team.some((c) => c.cleanerId === audit.cleanerId) ||
          backupIds.has(audit.cleanerId);
        audit.selectedRole =
          backupIds.has(audit.cleanerId)
            ? "backup"
            : team.some((c) => c.cleanerId === audit.cleanerId)
              ? laundryLead?.cleanerId === audit.cleanerId
                ? "laundry_lead"
                : "primary"
              : null;
      }
      await tx.insert(assignmentRuns).values({
        jobId: job.id,
        outcome: "assigned",
        actorId: "assignment-engine",
        context: {
          scheduledAt: job.checkInTime?.toISOString(),
          teamSize,
          policyVersion: "phase2c-v1",
          candidatesTruncated: candidateAudit.length > 500,
          workingCleanerIds: team.map((c) => c.cleanerId),
          backupCleanerId: firstBackupId,
          pairedBackups: versioned ? pairedBackups.map(p => ({ workerId: p.worker.cleanerId, backupId: p.backup.cleanerId })) : undefined,
        },
        candidates: candidateAudit.slice(0, 500),
      });
    });
  } catch (error) {
    throw new AssignmentCommitError(
      error instanceof Error ? error.message : "Assignment commit failed",
      candidateAudit.slice(0, 500).map((candidate) => ({
        ...candidate,
        selected: false,
        selectedRole: null,
        reasons: [...candidate.reasons, "assignment_commit_failed"],
      })),
      {
        scheduledAt: job.checkInTime.toISOString(),
        proposedWorkingCleanerIds: team.map((member) => member.cleanerId),
        proposedBackupCleanerId: firstBackupId,
      },
    );
  }

  // Notify every working team member — one at a time. `notifyAssignedPrimary`
  // issues DB reads, so a `Promise.all` here pipelines them onto one pooler
  // connection, which answers the first and silently drops the rest.
  // It has been invisible because a team of 1 fans out to nothing; residential
  // large homes and off-site VR jobs staff two. Same shape as.
  if (versioned) await dispatchJobOffers(job.id);
  for (const member of versioned ? [] : team) {
    await notifyAssignedPrimary(
      job.id,
      member.cleanerId,
      job.propertyId!,
      job.checkInTime,
      job.serviceType,
      getJobDisplay(job).label,
    );
  }

  return {
    jobId: job.id,
    status: "assigned",
    primaryCleanerId: leader.cleanerId,
    backupCleanerId: firstBackupId,
    backupCleanerIds: versioned ? [...backupIds] : undefined,
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
      checkOutTime: true,
      expectedHours: true,
      addonsSnapshot: true,
      checklistSnapshot: true,
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
      await db.insert(assignmentRuns).values({
        jobId: job.id,
        outcome: "failed",
        candidates: err instanceof AssignmentCommitError ? err.candidates : [],
        context: err instanceof AssignmentCommitError ? err.context : null,
        actorId: "assignment-engine",
        reason: (err instanceof Error
          ? err.message
          : "Assignment failed"
        ).slice(0, 500),
      });
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
  reason: string,
): Promise<void> {
  if (job.serviceType !== "residential_one_time") return;
  if (job.notes?.includes(ADMIN_REVIEW_NOTE_MARKER)) return;

  try {
    await db
      .update(jobs)
      .set({
        notes: appendJobNote(
          job.notes ?? null,
          `${ADMIN_REVIEW_NOTE_MARKER} the assignment engine could not staff this clean (${reason}).`,
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
      err,
    );
  }
}
