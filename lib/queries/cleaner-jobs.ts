import "server-only";

import { db } from "@/db";
import { jobs, jobsToCleaners, properties, cleaners } from "@/db/schemas";
import { and, eq, gte, lte, ne, inArray, asc } from "drizzle-orm";
import { getCleanerJobWindowEnd } from "@/lib/cleaner/planning-window";
import { CLEANER_HOURLY_RATE } from "@/lib/pricing/staffing-logic";

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
  expectedPay: number;
  role: CleanerJobRole;
  urgentBonus: boolean;
  teammates: CleanerJobTeammate[];
};

function mapRole(role: string): CleanerJobRole {
  if (role === "laundry_lead") return "laundryLead";
  if (role === "primary") return "teamLeader";
  if (role === "backup") return "backup";
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

  return assignments.map((assignment) => {
    const checkInTime = assignment.checkInTime;
    const canRequestSwap = checkInTime
      ? checkInTime.getTime() - Date.now() > 24 * 60 * 60 * 1000
      : false;

    return {
      jobId: assignment.jobId,
      propertyAddress: assignment.propertyAddress,
      arrivalWindow: formatDateTime(checkInTime),
      mustFinishBefore: formatDateTime(assignment.checkOutTime),
      scheduledAt: checkInTime?.toISOString() ?? null,
      canRequestSwap,
      expectedPay: calculateExpectedPay(
        assignment.expectedHours,
        assignment.role,
        assignment.urgentBonus,
        assignment.addonsSnapshot?.laundryLoads
      ),
      role: mapRole(assignment.role),
      urgentBonus: assignment.urgentBonus ?? false,
      teammates: teammatesByJob.get(assignment.jobId) ?? [],
    };
  });
}
