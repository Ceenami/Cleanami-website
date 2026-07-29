import "server-only";

import { db } from "@/db";
import {
  jobs,
  jobsToCleaners,
  properties,
  cleaners,
  swapRequests,
} from "@/db/schemas";
import { and, eq, gte, lte, ne, inArray, asc } from "drizzle-orm";
import { getCleanerJobWindowEnd } from "@/lib/cleaner/planning-window";
import { CLEANER_HOURLY_RATE } from "@/lib/pricing/staffing-logic";

/** Mirrors HOURS_BEFORE_JOB in `lib/queries/cleaner-swap.ts`. */
const SWAP_CUTOFF_HOURS = 24;

export type CleanerJobRole =
  | "primary"
  | "backup"
  | "teamLeader"
  | "laundryLead";

export type CleanerJobTeammate = {
  name: string;
};

export type CleanerJobSummary = {
  jobId: string;
  propertyAddress: string | null;
  arrivalWindow: string | null;
  mustFinishBefore: string | null;
  scheduledAt: string | null;
  canRequestSwap: boolean;
  /** Why a swap cannot be requested — shown next to the disabled option. */
  swapBlockedReason: string | null;
  /** Set while this cleaner has an open swap nobody has accepted yet. */
  pendingSwapRequestId: string | null;
  expectedPay: number;
  role: CleanerJobRole;
  urgentBonus: boolean;
  teammates: CleanerJobTeammate[];
};

function mapRole(role: string, isTeamLeader: boolean): CleanerJobRole {
  if (role === "laundry_lead") return "laundryLead";
  if (role === "backup") return "backup";
  if (role === "primary") return isTeamLeader ? "teamLeader" : "primary";
  return "primary";
}

function calculateExpectedPay(
  expectedHours: string | null,
  role: string,
  urgentBonus: boolean | null,
  laundryLoads?: number | null
): number {
  const hours = parseFloat(expectedHours || "0");
  let pay = hours * CLEANER_HOURLY_RATE;

  if (urgentBonus) {
    pay += 10;
  }

  if (role === "laundry_lead" && laundryLoads) {
    pay += laundryLoads * 5;
  }

  return Math.round(pay * 100) / 100;
}

function formatDateTime(date: Date | null): string | null {
  if (!date) return null;

  return date.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  });
}

export async function getCleanerUpcomingJobs(
  cleanerId: string
): Promise<CleanerJobSummary[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const windowEnd = getCleanerJobWindowEnd();

  const assignments = await db
    .select({
      jobId: jobs.id,
      checkInTime: jobs.checkInTime,
      checkOutTime: jobs.checkOutTime,
      expectedHours: jobs.expectedHours,
      addonsSnapshot: jobs.addonsSnapshot,
      propertyAddress: properties.address,
      role: jobsToCleaners.role,
      isTeamLeader: jobsToCleaners.isTeamLeader,
      urgentBonus: jobsToCleaners.urgentBonus,
    })
    .from(jobsToCleaners)
    .innerJoin(jobs, eq(jobsToCleaners.jobId, jobs.id))
    .leftJoin(properties, eq(jobs.propertyId, properties.id))
    .where(
      and(
        eq(jobsToCleaners.cleanerId, cleanerId),
        gte(jobs.checkInTime, today),
        lte(jobs.checkInTime, windowEnd),
        ne(jobs.status, "canceled")
      )
    )
    .orderBy(asc(jobs.checkInTime));

  if (assignments.length === 0) {
    return [];
  }

  const jobIds = assignments.map((a) => a.jobId);

  const allAssignments = await db
    .select({
      jobId: jobsToCleaners.jobId,
      cleanerId: jobsToCleaners.cleanerId,
      fullName: cleaners.fullName,
    })
    .from(jobsToCleaners)
    .innerJoin(cleaners, eq(jobsToCleaners.cleanerId, cleaners.id))
    .where(inArray(jobsToCleaners.jobId, jobIds));

  const teammatesByJob = new Map<string, CleanerJobTeammate[]>();
  for (const row of allAssignments) {
    if (row.cleanerId === cleanerId) continue;
    const list = teammatesByJob.get(row.jobId) ?? [];
    list.push({ name: row.fullName });
    teammatesByJob.set(row.jobId, list);
  }

  // A swap the cleaner has already opened is otherwise invisible to them: the
  // "submitted" message vanishes on the next page load and the button comes
  // back looking untouched.
  const pendingSwaps = await db
    .select({ id: swapRequests.id, jobId: swapRequests.jobId })
    .from(swapRequests)
    .where(
      and(
        inArray(swapRequests.jobId, jobIds),
        eq(swapRequests.originalCleanerId, cleanerId),
        eq(swapRequests.status, "pending")
      )
    );

  const pendingSwapByJob = new Map(pendingSwaps.map((s) => [s.jobId, s.id]));

  return assignments.map((assignment) => {
    const checkInTime = assignment.checkInTime;
    const isOutsideCutoff = checkInTime
      ? checkInTime.getTime() - Date.now() > SWAP_CUTOFF_HOURS * 60 * 60 * 1000
      : false;
    const pendingSwapRequestId = pendingSwapByJob.get(assignment.jobId) ?? null;
    const canRequestSwap = isOutsideCutoff && !pendingSwapRequestId;

    let swapBlockedReason: string | null = null;
    if (pendingSwapRequestId) {
      swapBlockedReason = "Swap already open";
    } else if (!checkInTime) {
      swapBlockedReason = "No start time scheduled yet";
    } else if (!isOutsideCutoff) {
      swapBlockedReason = `Starts in under ${SWAP_CUTOFF_HOURS} hours`;
    }

    return {
      jobId: assignment.jobId,
      propertyAddress: assignment.propertyAddress,
      arrivalWindow: formatDateTime(checkInTime),
      mustFinishBefore: formatDateTime(assignment.checkOutTime),
      scheduledAt: checkInTime?.toISOString() ?? null,
      canRequestSwap,
      swapBlockedReason,
      pendingSwapRequestId,
      expectedPay: calculateExpectedPay(
        assignment.expectedHours,
        assignment.role,
        assignment.urgentBonus,
        assignment.addonsSnapshot?.laundryLoads
      ),
      role: mapRole(assignment.role, assignment.isTeamLeader),
      urgentBonus: assignment.urgentBonus ?? false,
      teammates: teammatesByJob.get(assignment.jobId) ?? [],
    };
  });
}
