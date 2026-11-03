import "server-only";
import type { RoomPhotosMap } from "@/lib/cleaner/evidence";
import { effectiveChecklist } from "@/lib/services/effective-checklist";
import { getExecutionEvidence } from "@/lib/services/job-execution";
import { getExecutionContract } from "@/lib/services/job-execution-contract";

import { db } from "@/db";
import {
  evidencePackets,
  jobs,
  jobsToCleaners,
  reliabilityEvents,
} from "@/db/schemas";
import {
  CHECKLISTS_BUCKET,
  EVIDENCE_BUCKET,
  createSignedUrls,
} from "@/lib/storage/signed-url";
import {
  buildPayBreakdown,
  buildPayBreakdownFromPayout,
} from "@/lib/cleaner/pay-breakdown";
import {
  getExpectedChecklistItemsFromSnapshot,
  mergeChecklistItems,
} from "@/lib/cleaner/evidence";
import { ensureIssuedChecklist } from "@/lib/services/property-checklists";
import { evidenceDrafts } from "@/db/schemas";
import type { CleanerJobRole } from "@/lib/queries/cleaner-jobs";
import { and, eq, inArray, ne } from "drizzle-orm";
import { getArrivalWindow } from "@/lib/scheduling/arrival-windows";
import { getEntryMethod, getJobDisplay } from "@/lib/constants/service-type";

function mapRole(role: string, isTeamLeader: boolean): CleanerJobRole {
  if (role === "laundry_lead") return "laundryLead";
  if (role === "backup") return "backup";
  // Only the flagged team leader shows as leader; other team members are primary.
  if (role === "primary") return isTeamLeader ? "teamLeader" : "primary";
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

async function signChecklistFiles(
  files: {
    id: string;
    fileName: string;
    storagePath: string | null;
    sourceUrl: string | null;
  }[],
): Promise<{ id: string; fileName: string; url: string }[]> {
  const uploaded = files.filter((f) => f.storagePath);
  const urls = await createSignedUrls(
    CHECKLISTS_BUCKET,
    uploaded.map((file) => file.storagePath!),
  );
  let i = 0;
  return files.map((file) => {
    if (file.storagePath) {
      const url = urls[i] ?? "";
      i += 1;
      return { id: file.id, fileName: file.fileName, url };
    }
    return { id: file.id, fileName: file.fileName, url: file.sourceUrl ?? "" };
  });
}

// Room-photo maps hold private-bucket object paths; sign each one for viewing.
async function signRoomPhotos(
  roomPhotos: Record<string, string[]>,
): Promise<Record<string, string[]>> {
  const entries = await Promise.all(
    Object.entries(roomPhotos).map(async ([roomKey, paths]) => {
      const urls = await createSignedUrls(EVIDENCE_BUCKET, paths);
      return [roomKey, urls.map((u) => u ?? "")] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export type CleanerJobDetail = {
  jobId: string;
  executionProtocol?: string | null;
  cleanerId: string;
  assignmentRole: string;
  serviceLabel: string;
  scheduledAt: string | null;
  canWork: boolean;
  property: {
    bedCount: number;
    bathCount: number;
    latitude: number | null;
    longitude: number | null;
    geofenceRadiusMeters: number | null;
    defaultCheckOutTime: string | null;
  } | null;
  status: string;
  propertyAddress: string | null;
  arrivalWindow: string | null;
  mustFinishBefore: string | null;
  /**
   * Drives the pet note on the cleaner's job detail.
   *
   * Read live from the property, not from addons_snapshot.petsAllowed. The
   * snapshot is a pricing freeze and is the right source for what the customer
   * was billed; this is a warning about what the cleaner will walk into, so
   * current truth is what matters. They only diverge when an admin edits the
   * property after the job was created — exactly the case worth telling them.
   */
  petsAllowed: boolean;
  /** 0041. Drives the badge and every label below. */
  serviceType: string;
  cleaningLevel: "standard" | "deep" | null;
  /**
   * 0045 — an admin's manual "this one is a reclean" override, which takes the
   * badge over the service type. Null on every ordinary job. The TIME labels
   * below still follow `serviceType`: a reclean of a turnover is still
   * scheduled like a turnover.
   */
  jobLabel: string | null;
  /**
   * The mistake this exists to prevent: on a residential clean check_out_time is
   * the finish deadline (window end plus expected hours), so rendering it as the
   * end of the arrival window would tell a cleaner to finish a three-hour clean
   * inside a two-hour slot. The window's real bounds live only in the snapshot
   * key, which is what this resolves.
   *
   * Null on a vacation-rental job, which has a guest check-out time instead.
   */
  arrivalWindowLabel: string | null;
  /**
   * Entry method, access details, parking — credentials.
   *
   * Safe here and only here: this query is assignment-scoped, selecting through
   * jobsToCleaners on both cleanerId and jobId, so a cleaner who is not on this
   * job gets null for the whole detail. They are deliberately absent from
   * cleaner-jobs.ts — the job LIST must not carry a door code for every job a
   * cleaner can see.
   *
   * Read live from the property, never from addons_snapshot.
   */
  entryMethod: string | null;
  entryMethodLabel: string | null;
  entryInstructions: string | null;
  parkingInstructions: string | null;
  /**
   * The customer's own notes. Rendered SEPARATELY from the access details —
   * item 13 lists them separately, and a note about the dog is not a note about
   * the gate code.
   */
  customerNotes: string | null;
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
  jobId: string,
): Promise<CleanerJobDetail | null> {
  const assignment = await db.query.jobsToCleaners.findFirst({
    where: and(
      eq(jobsToCleaners.cleanerId, cleanerId),
      eq(jobsToCleaners.jobId, jobId),
    ),
    with: {
      // Pay is computed at the cleaner's own rate, not a flat default.
      cleaner: { columns: { hourlyRateCents: true } },
      job: {
        with: {
          property: {
            with: {
              checklistFiles: true,
            },
          },
          evidencePacket: true,
          payouts: true,
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
      inArray(reliabilityEvents.eventType, ["late_arrival", "no_show"]),
    ),
  });

  job.checklistSnapshot = await effectiveChecklist(jobId, job.checklistSnapshot);
  const executionContract = await getExecutionContract(jobId);
  const checklistFiles = await signChecklistFiles(executionContract ? job.checklistSnapshot?.files ?? [] : property?.checklistFiles ?? []);

  // The deduction is derived from the recorded lateness, in dollars — never
  // from `lateEvent.penaltyPoints`, which is a reliability score in points and
  // was previously subtracted from pay as if it were currency.
  const arrivalDelayMinutes = job.evidencePacket?.arrivalDelayMinutes ?? null;

  const storedPayout = job.payouts.find(
    (p) => p.cleanerId === cleanerId && p.payReceipt,
  );
  if (
    job.addonsSnapshot?.residentialPricing?.ruleVersion === "residential-v2" &&
    job.payouts.some((p) => p.cleanerId === cleanerId && !p.payReceipt)
  )
    throw new Error("Residential v2 payout receipt is missing");
  const payBreakdown = storedPayout
    ? buildPayBreakdownFromPayout({
        amount: Number(storedPayout.amount),
        payReceipt: storedPayout.payReceipt,
        urgentBonusAmount: Number(storedPayout.urgentBonusAmount ?? 0),
        laundryBonusAmount: Number(storedPayout.laundryBonusAmount ?? 0),
        latePenalty: Number(storedPayout.lateDeductionAmount ?? 0),
      })
    : buildPayBreakdown({
        residentialPricing: job.addonsSnapshot?.residentialPricing,
        assignmentTerms: assignment.residentialPayTerms,
        expectedHours: job.expectedHours,
        role: assignment.role,
        urgentBonus: assignment.urgentBonus,
        laundryLoads: job.addonsSnapshot?.laundryLoads,
        hourlyRateCents:
          assignment.frozenHourlyRateCents ??
          assignment.cleaner?.hourlyRateCents,
        arrivalDelayMinutes,
        latePenaltyReason: lateEvent
          ? `${lateEvent.eventType.replace("_", " ")} (${lateEvent.notes ?? "reliability event"})`
          : arrivalDelayMinutes && arrivalDelayMinutes > (executionContract ? 10 : 0)
            ? `Arrived ${arrivalDelayMinutes} min late`
            : null,
      });

  return {
    jobId: job.id,
    executionProtocol: executionContract?.protocol ?? null,
    cleanerId,
    assignmentRole: assignment.role,
    serviceLabel: getJobDisplay({
      serviceType: job.serviceType,
      jobLabel: job.jobLabel,
      cleaningLevel: job.addonsSnapshot?.cleaningLevel,
    }).label,
    scheduledAt: job.checkInTime?.toISOString() ?? null,
    canWork:
      ["primary", "laundry_lead"].includes(assignment.role) &&
      ["assigned", "in-progress", "completed_pending_evidence"].includes(
        job.status ?? "",
      ),
    property: property
      ? {
          bedCount: property.bedCount,
          bathCount: Number(property.bathCount),
          latitude:
            property.latitude == null ? null : Number(property.latitude),
          longitude:
            property.longitude == null ? null : Number(property.longitude),
          geofenceRadiusMeters: property.geofenceRadiusMeters,
          defaultCheckOutTime: property.defaultCheckOutTime,
        }
      : null,
    status: job.status ?? "assigned",
    propertyAddress: property?.address ?? null,
    arrivalWindow: formatDateTime(job.checkInTime),
    mustFinishBefore: formatDateTime(job.checkOutTime),
    petsAllowed: property?.petsAllowed ?? false,
    serviceType: job.serviceType ?? "vacation_rental_subscription",
    cleaningLevel: job.addonsSnapshot?.cleaningLevel ?? null,
    jobLabel: job.jobLabel ?? null,
    arrivalWindowLabel:
      job.serviceType === "residential_one_time"
        ? (getArrivalWindow(job.addonsSnapshot?.arrivalWindow ?? undefined)
            ?.label ?? null)
        : null,
    entryMethod: property?.entryMethod ?? null,
    entryMethodLabel: getEntryMethod(property?.entryMethod)?.label ?? null,
    entryInstructions: property?.entryInstructions ?? null,
    parkingInstructions: property?.parkingInstructions ?? null,
    customerNotes: property?.specialInstructions ?? null,
    role: mapRole(assignment.role, assignment.isTeamLeader),
    urgentBonus: assignment.urgentBonus ?? false,
    teammates: teammateRows
      .filter((row) => row.cleanerId !== cleanerId)
      .map((row) => ({ name: row.cleaner.fullName })),
    checklistFiles,
    payBreakdown,
    evidence: {
      isChecklistComplete: job.evidencePacket?.isChecklistComplete ?? false,
      status: job.evidencePacket?.status ?? null,
      hasSubmitted: executionContract ? !!job.evidencePacket?.finalEvidenceSubmittedAt : job.evidencePacket?.isChecklistComplete ?? false,
    },
  };
}

export async function getCleanerEvidenceFormData(
  cleanerId: string,
  jobId: string,
) {
  const issuedForm = await getExecutionEvidence(jobId, cleanerId);
  if (issuedForm) return issuedForm;
  const assignment = await db.query.jobsToCleaners.findFirst({
    where: and(
      eq(jobsToCleaners.cleanerId, cleanerId),
      eq(jobsToCleaners.jobId, jobId),
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
  const [draft] = await db
    .select()
    .from(evidenceDrafts)
    .where(
      and(
        eq(evidenceDrafts.jobId, jobId),
        eq(evidenceDrafts.cleanerId, cleanerId),
      ),
    );
  const existingLog = (
    evidence?.finalEvidenceSubmittedAt
      ? evidence.checklistLog
      : (draft?.state?.checklistLog ?? evidence?.checklistLog)
  ) as {
    items?: { id: string; task: string; completed: boolean }[];
    roomPhotos?: Record<string, string[]>;
  } | null;

  const snapshot = await ensureIssuedChecklist(
    jobId,
    {
      ...property,
      cleaningLevel: assignment.job.addonsSnapshot?.cleaningLevel,
    },
    property.checklistFiles,
    assignment.job.checklistSnapshot,
  );
  const checklistFiles = await signChecklistFiles(snapshot.files);

  // roomPhotos stores object paths (for submit); previews are signed for <img>.
  const roomPhotos: RoomPhotosMap = {};
  for (const log of [evidence?.checklistLog, existingLog]) {
    const rooms = (log as { roomPhotos?: RoomPhotosMap } | null)?.roomPhotos ?? {};
    for (const [room, paths] of Object.entries(rooms))
      roomPhotos[room] = [...new Set([...(roomPhotos[room] ?? []), ...paths])];
  }
  const roomPhotoPreviews = await signRoomPhotos(roomPhotos);

  const expectedChecklistItems =
    getExpectedChecklistItemsFromSnapshot(snapshot);

  return {
    jobId,
    queueOwner: cleanerId,
    evidenceOpen: !evidence?.finalEvidenceSubmittedAt &&
      ["in-progress", "completed_pending_evidence"].includes(assignment.job.status ?? ""),
    cleanerId,
    canCapture:
      assignment.job.status === "in-progress" &&
      !!evidence?.gpsCheckInTimestamp &&
      !evidence.gpsCheckOutTimestamp,
    explanations: draft?.explanations ?? {},
    roomRequirements: snapshot.photoRequirements!,
    property: {
      bedCount: property.bedCount,
      bathCount: property.bathCount,
      hasHotTub: property.hasHotTub,
      laundryType: property.laundryType,
      useDefaultChecklist: property.useDefaultChecklist,
    },
    checklistFiles,
    checklistItems: mergeChecklistItems(
      expectedChecklistItems,
      existingLog?.items ?? [],
    ),
    roomPhotos,
    roomPhotoPreviews,
    cleanerNotes: draft?.state?.cleanerNotes ?? evidence?.cleanerNotes ?? "",
    isSubmitted: !!evidence?.finalEvidenceSubmittedAt,
  };
}

export async function getCleanerInProgressJobIds(
  cleanerId: string,
  excludeJobId?: string,
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
