import "server-only";

import { db } from "@/db";
import {
  evidencePackets,
  jobs,
  jobsToCleaners,
  reliabilityEvents,
} from "@/db/schemas";
import { createAdminClient } from "@/lib/supabase/server";
import { buildPayBreakdown } from "@/lib/cleaner/pay-breakdown";
import { DEFAULT_CHECKLIST_ITEMS } from "@/lib/constants/default-checklist";
import type { CleanerJobRole } from "@/lib/queries/cleaner-jobs";
import { and, eq, inArray, ne } from "drizzle-orm";

function mapRole(role: string): CleanerJobRole {
  if (role === "laundry_lead") return "laundryLead";
  if (role === "primary") return "teamLeader";
  if (role === "backup") return "backup";
  return "primary";
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

export type CleanerJobDetail = {
  jobId: string;
  status: string;
  propertyAddress: string | null;
  arrivalWindow: string | null;
  mustFinishBefore: string | null;
  role: CleanerJobRole;
  urgentBonus: boolean;
  teammates: { name: string }[];
  checklistFiles: { id: string; fileName: string; url: string }[];
  payBreakdown: ReturnType<typeof buildPayBreakdown>;
  evidence: {
    isChecklistComplete: boolean;
    status: string | null;
    hasSubmitted: boolean;
  };
};

export async function getCleanerJobDetail(
  cleanerId: string,
  jobId: string
): Promise<CleanerJobDetail | null> {
  const assignment = await db.query.jobsToCleaners.findFirst({
    where: and(
      eq(jobsToCleaners.cleanerId, cleanerId),
      eq(jobsToCleaners.jobId, jobId)
    ),
    with: {
      job: {
        with: {
          property: {
            with: {
              checklistFiles: true,
            },
          },
          evidencePacket: true,
        },
      },
    },
  });

  if (!assignment?.job) {
    return null;
  }

  const job = assignment.job;
  const property = job.property;

  const teammateRows = await db.query.jobsToCleaners.findMany({
    where: eq(jobsToCleaners.jobId, jobId),
    with: {
      cleaner: { columns: { fullName: true } },
    },
  });

  const lateEvent = await db.query.reliabilityEvents.findFirst({
    where: and(
      eq(reliabilityEvents.jobId, jobId),
      eq(reliabilityEvents.cleanerId, cleanerId),
      inArray(reliabilityEvents.eventType, ["late_arrival", "no_show"])
    ),
  });

  const latePenalty = lateEvent?.penaltyPoints
    ? Math.min(lateEvent.penaltyPoints, 25)
    : 0;

  const supabase = createAdminClient();
  const checklistFiles = (property?.checklistFiles ?? []).map((file) => {
    const { data } = supabase.storage
      .from("checklists")
      .getPublicUrl(file.storagePath);
    return {
      id: file.id,
      fileName: file.fileName,
      url: data.publicUrl,
    };
  });

  const payBreakdown = buildPayBreakdown({
    expectedHours: job.expectedHours,
    role: assignment.role,
    urgentBonus: assignment.urgentBonus,
    laundryLoads: job.addonsSnapshot?.laundryLoads,
    latePenalty,
    latePenaltyReason: lateEvent
      ? `${lateEvent.eventType.replace("_", " ")} (${lateEvent.notes ?? "reliability event"})`
      : null,
  });

  return {
    jobId: job.id,
    status: job.status ?? "assigned",
    propertyAddress: property?.address ?? null,
    arrivalWindow: formatDateTime(job.checkInTime),
    mustFinishBefore: formatDateTime(job.checkOutTime),
    role: mapRole(assignment.role),
    urgentBonus: assignment.urgentBonus ?? false,
    teammates: teammateRows
      .filter((row) => row.cleanerId !== cleanerId)
      .map((row) => ({ name: row.cleaner.fullName })),
    checklistFiles,
    payBreakdown,
    evidence: {
      isChecklistComplete: job.evidencePacket?.isChecklistComplete ?? false,
      status: job.evidencePacket?.status ?? null,
      hasSubmitted: job.evidencePacket?.isChecklistComplete ?? false,
    },
  };
}

export async function getCleanerEvidenceFormData(
  cleanerId: string,
  jobId: string
) {
  const assignment = await db.query.jobsToCleaners.findFirst({
    where: and(
      eq(jobsToCleaners.cleanerId, cleanerId),
      eq(jobsToCleaners.jobId, jobId)
    ),
    with: {
      job: {
        with: {
          property: {
            with: { checklistFiles: true },
          },
          evidencePacket: true,
        },
      },
    },
  });

  if (!assignment?.job?.property) {
    return null;
  }

  const property = assignment.job.property;
  const evidence = assignment.job.evidencePacket;
  const existingLog = evidence?.checklistLog as
    | { items?: { id: string; task: string; completed: boolean }[]; roomPhotos?: Record<string, string[]> }
    | null;

  const supabase = createAdminClient();
  const checklistFiles = property.checklistFiles.map((file) => {
    const { data } = supabase.storage
      .from("checklists")
      .getPublicUrl(file.storagePath);
    return {
      id: file.id,
      fileName: file.fileName,
      url: data.publicUrl,
    };
  });

  return {
    jobId,
    property: {
      bedCount: property.bedCount,
      bathCount: property.bathCount,
      hasHotTub: property.hasHotTub,
      useDefaultChecklist: property.useDefaultChecklist,
    },
    checklistFiles,
    checklistItems: existingLog?.items?.length
      ? existingLog.items
      : DEFAULT_CHECKLIST_ITEMS,
    roomPhotos: existingLog?.roomPhotos ?? {},
    cleanerNotes: evidence?.cleanerNotes ?? "",
    isSubmitted: evidence?.isChecklistComplete ?? false,
  };
}

export async function getCleanerInProgressJobIds(
  cleanerId: string,
  excludeJobId?: string
) {
  const conditions = [
    eq(jobsToCleaners.cleanerId, cleanerId),
    eq(jobs.status, "in-progress"),
  ];
  if (excludeJobId) {
    conditions.push(ne(jobs.id, excludeJobId));
  }

  const rows = await db
    .select({ jobId: jobs.id })
    .from(jobsToCleaners)
    .innerJoin(jobs, eq(jobsToCleaners.jobId, jobs.id))
    .where(and(...conditions));

  return rows.map((r) => r.jobId);
}

export async function ensureEvidencePacket(jobId: string) {
  const existing = await db.query.evidencePackets.findFirst({
    where: eq(evidencePackets.jobId, jobId),
  });

  if (existing) return existing;

  const [created] = await db
    .insert(evidencePackets)
    .values({
      jobId,
      status: "incomplete",
    })
    .returning();

  return created;
}
