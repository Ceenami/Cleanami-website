import "server-only";
import { db } from "@/db";
import {
  cleaners,
  jobs,
  propertyExclusions,
  availability,
  availabilityDays,
  cleanerAvailabilitySubmissions,
} from "@/db/schemas";
import { and, eq, lte, gte } from "drizzle-orm";
import { assignmentReasons } from "./policy";
import { hasScheduleConflict } from "./schedule-conflict";
import { toEasternDateString } from "@/lib/time/eastern";
import { isChecklistSnapshot } from "@/lib/cleaner/checklist-snapshot";

/** Shared preview policy. 0050 repeats hard gates under transaction locks at commit. */
export async function assignmentEligibility(
  cleanerId: string,
  jobId: string,
  options?: {
    replaceCleanerId?: string;
    allowSameDay?: boolean;
    requireCompleteTeam?: boolean;
    role?: string;
  },
) {
  const job = await db.query.jobs.findFirst({
    where: eq(jobs.id, jobId),
    with: { cleaners: { with: { cleaner: true } } },
  });
  const cleaner = await db.query.cleaners.findFirst({
    where: eq(cleaners.id, cleanerId),
  });
  if (!job || !cleaner || !job.checkInTime)
    return { eligible: false, reasons: ["missing_job_cleaner_or_arrival"] };
  const exclusion = await db.query.propertyExclusions.findFirst({
    where: and(
      eq(propertyExclusions.propertyId, job.propertyId!),
      eq(propertyExclusions.cleanerId, cleanerId),
    ),
  });
  const reasons = assignmentReasons(cleaner, job, !!exclusion);
  if (!["assigned", "unassigned"].includes(job.status ?? ""))
    reasons.push("job_not_assignable");
  const date = toEasternDateString(job.checkInTime);
  const day = await db.query.availabilityDays.findFirst({
    where: and(
      eq(availabilityDays.cleanerId, cleanerId),
      eq(availabilityDays.date, date),
    ),
  });
  const legacy = await db.query.availability.findFirst({
    where: and(
      eq(availability.cleanerId, cleanerId),
      eq(availability.date, date),
    ),
  });
  const ack = await db.query.cleanerAvailabilitySubmissions.findFirst({
    where: and(
      eq(cleanerAvailabilitySubmissions.cleanerId, cleanerId),
      lte(cleanerAvailabilitySubmissions.periodStart, date),
      gte(cleanerAvailabilitySubmissions.periodEnd, date),
    ),
  });
  if (day ? !day.isAvailable : !legacy || !ack)
    reasons.push("no_acknowledged_available_date");
  if (
    await hasScheduleConflict({
      cleanerId,
      checkInTime: job.checkInTime,
      expectedHours: job.expectedHours,
      excludeJobId: jobId,
      rule: "window",
    })
  )
    reasons.push("physical_overlap");
  if (
    !options?.allowSameDay &&
    (await hasScheduleConflict({
      cleanerId,
      checkInTime: job.checkInTime,
      expectedHours: job.expectedHours,
      excludeJobId: jobId,
    }))
  )
    reasons.push("same_day_conflict");
  if (options?.role === "laundry_lead" && !cleaner.hasLaundryLeadCert)
    reasons.push("laundry_lead_not_qualified");
  const team = job.cleaners
    .filter(
      (a) =>
        ["primary", "laundry_lead"].includes(a.role) &&
        a.cleanerId !== options?.replaceCleanerId &&
        a.cleanerId !== cleanerId,
    )
    .map((a) => a.cleaner);
  team.push(cleaner);
  if (options?.requireCompleteTeam !== false) {
    const capabilities = isChecklistSnapshot(job.checklistSnapshot)
      ? job.checklistSnapshot.capabilityRequirements
      : undefined;
    if (
      job.addonsSnapshot?.requiresManualStaffing ||
      job.addonsSnapshot?.teamSize === null
    )
      reasons.push("manual_staffing_required");
    if (team.length < (job.addonsSnapshot?.teamSize ?? 1))
      reasons.push("incomplete_working_team");
    if (
      (capabilities?.hotTub ||
        (job.addonsSnapshot?.hotTubServiceLevel &&
          job.addonsSnapshot.hotTubServiceLevel !== "none")) &&
      !team.some((c) => c.hasHotTubCert)
    )
      reasons.push("team_missing_hot_tub_capability");
    if (
      (capabilities?.laundryLead ||
        job.addonsSnapshot?.laundryType === "off_site") &&
      !team.some((c) => c.hasLaundryLeadCert)
    )
      reasons.push("team_missing_laundry_lead");
  }
  return { eligible: reasons.length === 0, reasons };
}
