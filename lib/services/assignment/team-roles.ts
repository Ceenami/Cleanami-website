import "server-only";

import { db } from "@/db";
import { cleaners, jobs, jobsToCleaners } from "@/db/schemas";
import { and, eq } from "drizzle-orm";

/** Roles that do the work — backups and on-call shadows are not on the team. */
const WORKING_ROLES = new Set(["primary", "laundry_lead"]);

/**
 * Re-derives the Team Leader and Laundry Lead designations for a job.
 *
 * Both are properties of the *current* team rather than of the cleaner who
 * happened to be assigned first, so they have to be recomputed whenever the
 * roster changes — a swap taken over, a backup promoted, an admin reassignment.
 * Leaving them stale strands the team-leader flag on someone no longer working
 * the job and, for off-site laundry, misdirects the per-load bonus.
 *
 * Safe to call repeatedly: it writes only the rows whose designation changed.
 */
export async function recalculateJobRoles(jobId: string): Promise<void> {
  const job = await db.query.jobs.findFirst({
    where: eq(jobs.id, jobId),
    columns: { addonsSnapshot: true },
  });

  const assignments = await db
    .select({
      cleanerId: jobsToCleaners.cleanerId,
      role: jobsToCleaners.role,
      isTeamLeader: jobsToCleaners.isTeamLeader,
      reliabilityScore: cleaners.reliabilityScore,
      hasLaundryLeadCert: cleaners.hasLaundryLeadCert,
    })
    .from(jobsToCleaners)
    .innerJoin(cleaners, eq(jobsToCleaners.cleanerId, cleaners.id))
    .where(eq(jobsToCleaners.jobId, jobId));

  const team = assignments.filter((a) => WORKING_ROLES.has(a.role));
  if (team.length === 0) return;

  const scoreOf = (value: string | null) => {
    const n = parseFloat(value ?? "100");
    return Number.isFinite(n) ? n : 100;
  };

  // Team Leader = most reliable working cleaner. No extra pay attaches to it.
  const leader = team.reduce(
    (best, current) =>
      scoreOf(current.reliabilityScore) > scoreOf(best.reliabilityScore)
        ? current
        : best,
    team[0]
  );

  // Laundry Lead exists only on off-site laundry jobs and carries the $5/load
  // bonus, so it must sit with a working cleaner — preferably a certified one.
  const isOffSite = job?.addonsSnapshot?.laundryType === "off_site";
  const laundryLead = isOffSite
    ? team.find((m) => m.hasLaundryLeadCert) ?? leader
    : null;

  const now = new Date();

  for (const assignment of assignments) {
    const isLeader = assignment.cleanerId === leader.cleanerId;
    const nextRole = WORKING_ROLES.has(assignment.role)
      ? assignment.cleanerId === laundryLead?.cleanerId
        ? "laundry_lead"
        : "primary"
      : assignment.role;

    if (assignment.isTeamLeader === isLeader && assignment.role === nextRole) {
      continue;
    }

    await db
      .update(jobsToCleaners)
      .set({ isTeamLeader: isLeader, role: nextRole, updatedAt: now })
      .where(
        and(
          eq(jobsToCleaners.jobId, jobId),
          eq(jobsToCleaners.cleanerId, assignment.cleanerId)
        )
      );
  }
}
