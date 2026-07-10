import "server-only";

import { db } from "@/db";
import { jobs, jobsToCleaners, notifications, swapRequests } from "@/db/schemas";
import { getCleanerUserId } from "@/lib/queries/cleaner-notifications";
import { and, eq, ne, sql } from "drizzle-orm";

const SWAP_LIMIT = 3;
const HOURS_BEFORE_JOB = 24;
const SWAP_NOTIFY_LIMIT = 5;

type SwapEligibilityRow = {
  cleaner_id: string;
  full_name: string;
  reliability_score: string | number | null;
  swap_count: number;
  is_eligible: boolean;
  conflict_reason: string | null;
};

export type ApproveSwapResult =
  | {
      success: true;
      outcome: "backup_promoted";
      replacementCleanerName: string;
    }
  | {
      success: true;
      outcome: "awaiting_accept";
      notifiedCount: number;
    }
  | {
      success: true;
      outcome: "removed_from_job";
    }
  | { success: false; message: string };

function firstName(fullName: string): string {
  return fullName.split(" ")[0] ?? fullName;
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
    metadata: { source: "cleaner_swap" },
  });
}

async function getSwapEligibleCleanerIds(
  jobId: string,
  originalCleanerId: string
): Promise<string[]> {
  const rows = await db.execute<SwapEligibilityRow>(
    sql`SELECT * FROM check_swap_eligibility(${jobId}::uuid, ${originalCleanerId}::uuid)`
  );

  return rows
    .filter((r) => r.is_eligible)
    .map((r) => r.cleaner_id)
    .slice(0, SWAP_NOTIFY_LIMIT);
}

export async function createCleanerSwapRequest(
  cleanerId: string,
  jobId: string
): Promise<
  | {
      success: true;
      eligibleCleanerNames: string[];
      message: string;
    }
  | { success: false; message: string }
> {
  const job = await db.query.jobs.findFirst({
    where: eq(jobs.id, jobId),
    with: { cleaners: true },
  });

  if (!job) {
    return { success: false, message: "Job not found." };
  }

  const isAssigned = job.cleaners.some((c) => c.cleanerId === cleanerId);
  if (!isAssigned) {
    return { success: false, message: "You are not assigned to this job." };
  }

  if (!job.checkInTime) {
    return {
      success: false,
      message: "This job does not have a scheduled start time yet.",
    };
  }

  const msUntilJob = job.checkInTime.getTime() - Date.now();
  if (msUntilJob <= HOURS_BEFORE_JOB * 60 * 60 * 1000) {
    return {
      success: false,
      message:
        "Swaps must be requested more than 24 hours before the job starts.",
    };
  }

  const swapCountRows = await db.execute<{ get_cleaner_swap_count: number }>(
    sql`SELECT get_cleaner_swap_count(${cleanerId}::uuid) as get_cleaner_swap_count`
  );
  const swapCount = Number(swapCountRows[0]?.get_cleaner_swap_count ?? 0);

  if (swapCount >= SWAP_LIMIT) {
    return {
      success: false,
      message: `You've reached the swap limit (${SWAP_LIMIT} per 60 days).`,
    };
  }

  const existingPending = await db.query.swapRequests.findFirst({
    where: and(
      eq(swapRequests.jobId, jobId),
      eq(swapRequests.originalCleanerId, cleanerId),
      eq(swapRequests.status, "pending")
    ),
  });

  if (existingPending) {
    return {
      success: false,
      message: "You already have a pending swap request for this job.",
    };
  }

  const eligibilityRows = await db.execute<SwapEligibilityRow>(
    sql`SELECT * FROM check_swap_eligibility(${jobId}::uuid, ${cleanerId}::uuid)`
  );

  const eligible = eligibilityRows.filter((r) => r.is_eligible);

  if (eligible.length === 0) {
    const reason =
      eligibilityRows.find((r) => r.conflict_reason)?.conflict_reason ??
      "No eligible cleaners are available for a swap right now.";
    return { success: false, message: reason };
  }

  const expiresAt = new Date(
    job.checkInTime.getTime() - HOURS_BEFORE_JOB * 60 * 60 * 1000
  );

  await db.insert(swapRequests).values({
    jobId,
    originalCleanerId: cleanerId,
    status: "pending",
    expiresAt,
  });

  return {
    success: true,
    eligibleCleanerNames: eligible.map((r) => firstName(r.full_name)),
    message:
      "Your swap request was submitted for admin review. You'll be notified once it's approved or denied.",
  };
}

export async function approveCleanerSwapRequest(
  swapRequestId: string
): Promise<ApproveSwapResult> {
  const swap = await db.query.swapRequests.findFirst({
    where: eq(swapRequests.id, swapRequestId),
    with: {
      job: {
        with: {
          property: { columns: { address: true } },
          cleaners: {
            with: { cleaner: { columns: { id: true, fullName: true } } },
          },
        },
      },
    },
  });

  if (!swap) {
    return { success: false, message: "Swap request not found." };
  }

  if (swap.status !== "pending") {
    return { success: false, message: "Swap request is no longer pending." };
  }

  const job = swap.job;
  if (!job) {
    return { success: false, message: "Job not found." };
  }

  if (job.status === "canceled" || job.status === "completed") {
    return {
      success: false,
      message: "Cannot approve a swap on a completed or canceled job.",
    };
  }

  const originalCleanerId = swap.originalCleanerId;
  const assignment = job.cleaners.find((c) => c.cleanerId === originalCleanerId);

  if (!assignment) {
    return {
      success: false,
      message: "The requesting cleaner is no longer assigned to this job.",
    };
  }

  const now = new Date();
  const address = job.property?.address ?? "the property";
  const originalName = assignment.cleaner?.fullName ?? "Cleaner";

  await db
    .update(swapRequests)
    .set({ status: "cancelled", updatedAt: now })
    .where(
      and(
        eq(swapRequests.jobId, swap.jobId),
        eq(swapRequests.status, "urgent"),
        ne(swapRequests.id, swapRequestId)
      )
    );

  const role = assignment.role;
  const backup = job.cleaners.find((c) => c.role === "backup");

  if (role === "primary" && backup && backup.cleanerId !== originalCleanerId) {
    const backupName = backup.cleaner?.fullName ?? "Backup cleaner";

    await db
      .delete(jobsToCleaners)
      .where(
        and(
          eq(jobsToCleaners.jobId, swap.jobId),
          eq(jobsToCleaners.cleanerId, originalCleanerId)
        )
      );

    await db
      .update(jobsToCleaners)
      .set({ role: "primary", updatedAt: now })
      .where(
        and(
          eq(jobsToCleaners.jobId, swap.jobId),
          eq(jobsToCleaners.cleanerId, backup.cleanerId)
        )
      );

    await db
      .update(jobs)
      .set({ status: "assigned", updatedAt: now })
      .where(eq(jobs.id, swap.jobId));

    await db
      .update(swapRequests)
      .set({
        status: "accepted",
        replacementCleanerId: backup.cleanerId,
        updatedAt: now,
      })
      .where(eq(swapRequests.id, swapRequestId));

    await notifyCleaner(
      backup.cleanerId,
      "urgent_job",
      "You are now primary",
      `${originalName}'s swap was approved. You have been promoted to primary for ${address}.`,
      swap.jobId
    );

    await notifyCleaner(
      originalCleanerId,
      "urgent_job",
      "Swap approved",
      `Your swap for ${address} was approved. ${backupName} is now primary on this job.`,
      swap.jobId
    );

    return {
      success: true,
      outcome: "backup_promoted",
      replacementCleanerName: backupName,
    };
  }

  if (role === "primary") {
    await db
      .delete(jobsToCleaners)
      .where(
        and(
          eq(jobsToCleaners.jobId, swap.jobId),
          eq(jobsToCleaners.cleanerId, originalCleanerId),
          eq(jobsToCleaners.role, "primary")
        )
      );

    await db
      .update(jobs)
      .set({ status: "unassigned", updatedAt: now })
      .where(eq(jobs.id, swap.jobId));

    await db
      .update(swapRequests)
      .set({ status: "urgent", updatedAt: now })
      .where(eq(swapRequests.id, swapRequestId));

    const candidateIds = await getSwapEligibleCleanerIds(
      swap.jobId,
      originalCleanerId
    );

    for (const cleanerId of candidateIds) {
      await notifyCleaner(
        cleanerId,
        "swap_available",
        "Swap opportunity available",
        `An approved swap opened a spot at ${address}. Tap Accept to claim it — first to accept gets the job.`,
        swap.jobId
      );
    }

    await notifyCleaner(
      originalCleanerId,
      "urgent_job",
      "Swap approved",
      `Your swap for ${address} was approved. You're off this job while we find a replacement.`,
      swap.jobId
    );

    return {
      success: true,
      outcome: "awaiting_accept",
      notifiedCount: candidateIds.length,
    };
  }

  await db
    .delete(jobsToCleaners)
    .where(
      and(
        eq(jobsToCleaners.jobId, swap.jobId),
        eq(jobsToCleaners.cleanerId, originalCleanerId)
      )
    );

  await db
    .update(swapRequests)
    .set({ status: "accepted", updatedAt: now })
    .where(eq(swapRequests.id, swapRequestId));

  await notifyCleaner(
    originalCleanerId,
    "urgent_job",
    "Swap approved",
    `Your swap for ${address} was approved. You've been removed from this job.`,
    swap.jobId
  );

  return { success: true, outcome: "removed_from_job" };
}

export async function denyCleanerSwapRequest(
  swapRequestId: string
): Promise<{ success: true } | { success: false; message: string }> {
  const swap = await db.query.swapRequests.findFirst({
    where: eq(swapRequests.id, swapRequestId),
    with: {
      job: {
        with: { property: { columns: { address: true } } },
      },
    },
  });

  if (!swap) {
    return { success: false, message: "Swap request not found." };
  }

  if (swap.status !== "pending") {
    return { success: false, message: "Swap request is no longer pending." };
  }

  const address = swap.job?.property?.address ?? "the property";

  await db
    .update(swapRequests)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(swapRequests.id, swapRequestId));

  await notifyCleaner(
    swap.originalCleanerId,
    "urgent_job",
    "Swap denied",
    `Your swap request for ${address} was denied. You remain assigned to this job.`,
    swap.jobId
  );

  return { success: true };
}
