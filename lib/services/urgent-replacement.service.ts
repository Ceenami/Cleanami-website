import "server-only";

import { db } from "@/db";
import {
  availability,
  cleaners,
  jobs,
  jobsToCleaners,
  notifications,
  reliabilityEvents,
  swapRequests,
} from "@/db/schemas";
import { isCleanerAssignmentEligible } from "@/lib/cleaner/eligibility";
import { getCleanerUserId } from "@/lib/queries/cleaner-notifications";
import { getAllEligibleCleanersForJob, getAvailableCleanersForJob } from "@/lib/queries/cleaners-proximity";
import { and, eq, inArray, ne, or } from "drizzle-orm";

const URGENT_NEARBY_NOTIFY_LIMIT = 5;
const CALL_OUT_PENALTY = 15;

export type UrgentReplacementResult =
  | {
      outcome: "backup_promoted";
      replacementCleanerId: string;
      replacementCleanerName: string;
    }
  | {
      outcome: "awaiting_accept";
      notifiedCount: number;
    };

function jobDateString(checkInTime: Date): string {
  return checkInTime.toISOString().slice(0, 10);
}

async function notifyCleaner(
  cleanerId: string,
  type: "urgent_job" | "swap_available",
  title: string,
  message: string,
  jobId: string
) {
  const userId = await getCleanerUserId(cleanerId);
  if (!userId) return;

  await db.insert(notifications).values({
    userId,
    type,
    title,
    message,
    jobId,
    metadata: { source: "urgent_replacement" },
  });
}

async function recordCallOut(cleanerId: string, jobId: string) {
  await db.insert(reliabilityEvents).values({
    cleanerId,
    jobId,
    eventType: "call_out",
    penaltyPoints: CALL_OUT_PENALTY,
    notes: "Removed via urgent replacement",
  });
}

async function hasScheduleConflict(
  cleanerId: string,
  checkInTime: Date,
  excludeJobId?: string
): Promise<boolean> {
  const rows = await db
    .select({ jobId: jobs.id })
    .from(jobsToCleaners)
    .innerJoin(jobs, eq(jobsToCleaners.jobId, jobs.id))
    .where(
      and(
        eq(jobsToCleaners.cleanerId, cleanerId),
        eq(jobs.checkInTime, checkInTime),
        ne(jobs.status, "canceled"),
        excludeJobId ? ne(jobs.id, excludeJobId) : undefined
      )
    )
    .limit(1);

  return rows.length > 0;
}

async function getOnCallOpenPoolCleanerIds(
  checkInTime: Date,
  excludeCleanerIds: Set<string>
): Promise<string[]> {
  const date = jobDateString(checkInTime);
  const rows = await db.query.availability.findMany({
    where: and(
      eq(availability.date, date),
      or(
        eq(availability.onCallEligible, true),
        eq(availability.openPoolEligible, true)
      )
    ),
    columns: { cleanerId: true },
  });

  const ids: string[] = [];
  for (const row of rows) {
    if (excludeCleanerIds.has(row.cleanerId)) continue;
    if (ids.includes(row.cleanerId)) continue;

    const cleaner = await db.query.cleaners.findFirst({
      where: eq(cleaners.id, row.cleanerId),
      columns: { eligibleForAssignments: true },
    });
    if (!isCleanerAssignmentEligible(cleaner)) continue;
    if (await hasScheduleConflict(row.cleanerId, checkInTime)) continue;

    ids.push(row.cleanerId);
  }

  return ids;
}

/** Nearby first, then on-call/open pool, then all other eligible cleaners. */
async function buildUrgentNotificationCleanerIds(
  jobId: string,
  checkInTime: Date,
  excludeCleanerIds: Set<string>
): Promise<string[]> {
  const notified = new Set<string>();
  const ordered: string[] = [];

  const add = (cleanerId: string) => {
    if (excludeCleanerIds.has(cleanerId) || notified.has(cleanerId)) return;
    notified.add(cleanerId);
    ordered.push(cleanerId);
  };

  const { cleaners: nearby } = await getAvailableCleanersForJob(jobId, {
    includeOnJob: false,
  });
  for (const candidate of nearby.slice(0, URGENT_NEARBY_NOTIFY_LIMIT)) {
    if (await hasScheduleConflict(candidate.id, checkInTime, jobId)) continue;
    add(candidate.id);
  }

  for (const cleanerId of await getOnCallOpenPoolCleanerIds(
    checkInTime,
    excludeCleanerIds
  )) {
    if (await hasScheduleConflict(cleanerId, checkInTime, jobId)) continue;
    add(cleanerId);
  }

  const { cleaners: allEligible } = await getAllEligibleCleanersForJob(jobId, {
    includeOnJob: false,
  });
  for (const candidate of allEligible) {
    if (await hasScheduleConflict(candidate.id, checkInTime, jobId)) continue;
    add(candidate.id);
  }

  return ordered;
}

/** Job still has an open urgent swap, no primary, and status is unassigned. */
export async function getClaimableUrgentJobIds(
  jobIds: string[]
): Promise<Set<string>> {
  if (jobIds.length === 0) return new Set();

  const unique = [...new Set(jobIds)];

  const jobRows = await db.query.jobs.findMany({
    where: inArray(jobs.id, unique),
    columns: { id: true, status: true },
  });

  const openUrgent = await db.query.swapRequests.findMany({
    where: and(
      inArray(swapRequests.jobId, unique),
      eq(swapRequests.status, "urgent")
    ),
    columns: { jobId: true },
  });
  const urgentJobIds = new Set(openUrgent.map((s) => s.jobId));

  const primaries = await db.query.jobsToCleaners.findMany({
    where: and(
      inArray(jobsToCleaners.jobId, unique),
      eq(jobsToCleaners.role, "primary")
    ),
    columns: { jobId: true },
  });
  const filledJobIds = new Set(primaries.map((p) => p.jobId));

  const claimable = new Set<string>();
  for (const job of jobRows) {
    if (
      job.status === "unassigned" &&
      urgentJobIds.has(job.id) &&
      !filledJobIds.has(job.id)
    ) {
      claimable.add(job.id);
    }
  }

  return claimable;
}

export async function isUrgentJobClaimable(jobId: string): Promise<boolean> {
  const claimable = await getClaimableUrgentJobIds([jobId]);
  return claimable.has(jobId);
}

export async function dismissUrgentSwapNotifications(jobId: string) {
  await db
    .update(notifications)
    .set({ isRead: true })
    .where(
      and(
        eq(notifications.jobId, jobId),
        eq(notifications.type, "swap_available")
      )
    );
}

export async function canCleanerAcceptUrgentJob(
  cleanerId: string,
  jobId: string
): Promise<{ eligible: boolean; reason?: string }> {
  const cleaner = await db.query.cleaners.findFirst({
    where: eq(cleaners.id, cleanerId),
    columns: {
      userId: true,
      eligibleForAssignments: true,
    },
  });

  if (!isCleanerAssignmentEligible(cleaner)) {
    return {
      eligible: false,
      reason: "You are not eligible for job assignments yet.",
    };
  }

  const job = await db.query.jobs.findFirst({
    where: eq(jobs.id, jobId),
    with: { property: { columns: { address: true } } },
  });

  if (!job) {
    return { eligible: false, reason: "Job not found." };
  }

  if (job.status !== "unassigned") {
    return { eligible: false, reason: "This job has already been filled." };
  }

  if (!job.checkInTime) {
    return { eligible: false, reason: "Job has no scheduled start time." };
  }

  const openUrgent = await db.query.swapRequests.findFirst({
    where: and(
      eq(swapRequests.jobId, jobId),
      eq(swapRequests.status, "urgent")
    ),
  });

  if (!openUrgent) {
    return { eligible: false, reason: "No urgent replacement is open for this job." };
  }

  const existingPrimary = await db.query.jobsToCleaners.findFirst({
    where: and(
      eq(jobsToCleaners.jobId, jobId),
      eq(jobsToCleaners.role, "primary")
    ),
    columns: { jobId: true },
  });

  if (existingPrimary) {
    return { eligible: false, reason: "This job has already been filled." };
  }

  if (await hasScheduleConflict(cleanerId, job.checkInTime, jobId)) {
    return { eligible: false, reason: "You already have a job at this time." };
  }

  // Any assignment-eligible cleaner may accept an open urgent job (admin-expanded pool).
  return { eligible: true };
}

export async function triggerUrgentReplacement(
  jobId: string
): Promise<UrgentReplacementResult> {
  const job = await db.query.jobs.findFirst({
    where: eq(jobs.id, jobId),
    with: {
      cleaners: {
        with: { cleaner: { columns: { id: true, fullName: true } } },
      },
      property: { columns: { address: true } },
    },
  });

  if (!job) {
    throw new Error("Job not found");
  }

  if (job.status === "canceled" || job.status === "completed") {
    throw new Error("Cannot trigger replacement on a completed or canceled job");
  }

  const primary = job.cleaners.find((a) => a.role === "primary");
  if (!primary) {
    throw new Error("No primary cleaner assigned to this job");
  }

  const primaryCleanerId = primary.cleanerId;
  const primaryName = primary.cleaner?.fullName ?? "Cleaner";
  const backup = job.cleaners.find((a) => a.role === "backup");
  const now = new Date();
  const expiresAt =
    job.checkInTime && job.checkInTime.getTime() > now.getTime()
      ? new Date(job.checkInTime.getTime() - 30 * 60 * 1000)
      : new Date(now.getTime() + 60 * 60 * 1000);

  await db
    .update(swapRequests)
    .set({ status: "cancelled", updatedAt: now })
    .where(and(eq(swapRequests.jobId, jobId), eq(swapRequests.status, "urgent")));

  await recordCallOut(primaryCleanerId, jobId);

  await db
    .delete(jobsToCleaners)
    .where(
      and(
        eq(jobsToCleaners.jobId, jobId),
        eq(jobsToCleaners.cleanerId, primaryCleanerId),
        eq(jobsToCleaners.role, "primary")
      )
    );

  if (backup) {
    const backupName = backup.cleaner?.fullName ?? "Backup cleaner";
    const address = job.property?.address ?? "the property";

    await db
      .update(jobsToCleaners)
      .set({
        role: "primary",
        urgentBonus: true,
        updatedAt: now,
      })
      .where(
        and(
          eq(jobsToCleaners.jobId, jobId),
          eq(jobsToCleaners.cleanerId, backup.cleanerId)
        )
      );

    await db
      .update(jobs)
      .set({ status: "assigned", updatedAt: now })
      .where(eq(jobs.id, jobId));

    await db.insert(swapRequests).values({
      jobId,
      originalCleanerId: primaryCleanerId,
      replacementCleanerId: backup.cleanerId,
      status: "accepted",
      expiresAt,
    });

    await notifyCleaner(
      backup.cleanerId,
      "urgent_job",
      "You are now primary",
      `You have been promoted to primary for ${address} with a $10 urgent bonus. ${primaryName} was removed.`,
      jobId
    );

    return {
      outcome: "backup_promoted",
      replacementCleanerId: backup.cleanerId,
      replacementCleanerName: backupName,
    };
  }

  await db
    .update(jobs)
    .set({ status: "unassigned", updatedAt: now })
    .where(eq(jobs.id, jobId));

  await db.insert(swapRequests).values({
    jobId,
    originalCleanerId: primaryCleanerId,
    status: "urgent",
    expiresAt,
  });

  const address = job.property?.address ?? "a nearby property";
  const excludeIds = new Set([primaryCleanerId]);
  const toNotify = await buildUrgentNotificationCleanerIds(
    jobId,
    job.checkInTime!,
    excludeIds
  );

  for (const cleanerId of toNotify) {
    await notifyCleaner(
      cleanerId,
      "swap_available",
      "Urgent job available",
      `Tap Accept to claim an urgent clean at ${address}. Includes a $10 bonus. First to accept gets the job.`,
      jobId
    );
  }

  return {
    outcome: "awaiting_accept",
    notifiedCount: toNotify.length,
  };
}

export type UrgentJobOffer = {
  jobId: string;
  propertyAddress: string | null;
  checkInTime: string | null;
  canAccept: boolean;
};

export async function getUrgentJobOffers(
  cleanerId: string
): Promise<UrgentJobOffer[]> {
  const cleaner = await db.query.cleaners.findFirst({
    where: eq(cleaners.id, cleanerId),
    columns: { userId: true, eligibleForAssignments: true },
  });

  if (!isCleanerAssignmentEligible(cleaner)) {
    return [];
  }

  const openSwaps = await db.query.swapRequests.findMany({
    where: eq(swapRequests.status, "urgent"),
    with: {
      job: {
        with: {
          property: { columns: { address: true } },
        },
      },
    },
  });

  const candidateJobIds = openSwaps
    .filter((swap) => swap.job?.status === "unassigned")
    .map((swap) => swap.jobId);

  const claimableJobIds = await getClaimableUrgentJobIds(candidateJobIds);

  const offers: UrgentJobOffer[] = [];

  for (const swap of openSwaps) {
    if (!claimableJobIds.has(swap.jobId)) continue;

    const { eligible } = await canCleanerAcceptUrgentJob(cleanerId, swap.jobId);
    if (!eligible) continue;

    offers.push({
      jobId: swap.jobId,
      propertyAddress: swap.job?.property?.address ?? null,
      checkInTime: swap.job?.checkInTime?.toISOString() ?? null,
      canAccept: true,
    });
  }

  return offers;
}

export async function acceptUrgentJob(
  cleanerId: string,
  jobId: string
): Promise<{ success: true } | { success: false; message: string }> {
  const eligibility = await canCleanerAcceptUrgentJob(cleanerId, jobId);
  if (!eligibility.eligible) {
    return { success: false, message: eligibility.reason ?? "Not eligible" };
  }

  try {
    await db.transaction(async (tx) => {
      const job = await tx.query.jobs.findFirst({
        where: eq(jobs.id, jobId),
        columns: { id: true, status: true },
      });

      if (!job || job.status !== "unassigned") {
        throw new Error("JOB_FILLED");
      }

      const openUrgent = await tx.query.swapRequests.findFirst({
        where: and(
          eq(swapRequests.jobId, jobId),
          eq(swapRequests.status, "urgent")
        ),
      });

      if (!openUrgent) {
        throw new Error("NO_URGENT_REQUEST");
      }

      const existingPrimary = await tx.query.jobsToCleaners.findFirst({
        where: and(
          eq(jobsToCleaners.jobId, jobId),
          eq(jobsToCleaners.role, "primary")
        ),
      });

      if (existingPrimary) {
        throw new Error("JOB_FILLED");
      }

      const now = new Date();

      await tx.insert(jobsToCleaners).values({
        jobId,
        cleanerId,
        role: "primary",
        urgentBonus: true,
      });

      await tx
        .update(jobs)
        .set({ status: "assigned", updatedAt: now })
        .where(eq(jobs.id, jobId));

      await tx
        .update(swapRequests)
        .set({
          status: "accepted",
          replacementCleanerId: cleanerId,
          updatedAt: now,
        })
        .where(eq(swapRequests.id, openUrgent.id));
    });

    await dismissUrgentSwapNotifications(jobId);

    const job = await db.query.jobs.findFirst({
      where: eq(jobs.id, jobId),
      with: { property: { columns: { address: true } } },
    });

    await notifyCleaner(
      cleanerId,
      "urgent_job",
      "Job claimed",
      `You accepted the urgent job at ${job?.property?.address ?? "the property"}. $10 bonus applies.`,
      jobId
    );

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "JOB_FILLED") {
      return {
        success: false,
        message: "Another cleaner already accepted this job.",
      };
    }
    if (message === "NO_URGENT_REQUEST") {
      return {
        success: false,
        message: "This urgent replacement is no longer available.",
      };
    }
    throw err;
  }
}

export async function hasOpenUrgentSwap(jobId: string): Promise<boolean> {
  const row = await db.query.swapRequests.findFirst({
    where: and(eq(swapRequests.jobId, jobId), eq(swapRequests.status, "urgent")),
    columns: { id: true },
  });
  return Boolean(row);
}
