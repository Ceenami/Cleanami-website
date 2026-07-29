import "server-only";

import { db } from "@/db";
import { cleaners, jobs, jobsToCleaners, swapRequests } from "@/db/schemas";
import { notifyAdmins } from "@/lib/queries/admin-notifications";
import { recalculateJobRoles } from "@/lib/services/assignment/team-roles";
import { notifyCleaner } from "@/lib/services/notifications/notify";
import {
  canCleanerCoverSwap,
  getSwapCandidates,
} from "@/lib/services/swap/swap-candidates";
import {
  dismissSwapAvailableNotifications,
  triggerUrgentReplacement,
} from "@/lib/services/urgent-replacement.service";
import { and, eq, gte, inArray, lt } from "drizzle-orm";

const SWAP_LIMIT = 3;
const SWAP_LIMIT_WINDOW_DAYS = 60;
const HOURS_BEFORE_JOB = 24;
const SWAP_QUEUE_URL = "/admin/job-oversight?view=swaps";
export const SWAP_REASON_MAX_LENGTH = 500;

/**
 * Swaps a cleaner has put to the network in the rolling window.
 *
 * Counts requests, not completions: the ceiling exists to stop a cleaner
 * handing work away repeatedly, and whether a colleague happened to pick it up
 * is not something the requester controls. Withdrawn and admin-revoked requests
 * (both land on `cancelled`) are excluded so retracting a mistake costs nothing.
 *
 * The `get_cleaner_swap_count` SQL function counts accepted rows only, which
 * left the ceiling unenforceable — an uncovered request cost nothing, so a
 * cleaner could open any number of them. It is left alone because the native
 * app shares this database.
 */
async function countRecentSwapRequests(cleanerId: string): Promise<number> {
  const since = new Date(
    Date.now() - SWAP_LIMIT_WINDOW_DAYS * 24 * 60 * 60 * 1000
  );

  const rows = await db
    .select({ id: swapRequests.id })
    .from(swapRequests)
    .where(
      and(
        eq(swapRequests.originalCleanerId, cleanerId),
        gte(swapRequests.requestedAt, since),
        inArray(swapRequests.status, ["pending", "accepted", "expired"])
      )
    );

  return rows.length;
}

function formatJobTime(date: Date | null | undefined): string {
  if (!date) return "an unscheduled clean";

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

function firstName(fullName: string): string {
  return fullName.split(" ")[0] ?? fullName;
}

export type CreateSwapRequestResult =
  | {
      success: true;
      swapRequestId: string;
      notifiedCount: number;
      eligibleCleanerNames: string[];
      message: string;
    }
  | { success: false; message: string };

/**
 * Opens a swap.
 *
 * The request goes live immediately: eligible cleaners are notified and the
 * first to accept takes the job over. The requesting cleaner stays assigned
 * until that happens, so the clean is never left uncovered while the offer is
 * outstanding. Admins are notified for visibility and can override the request
 * either way while it is still open.
 */
export async function createCleanerSwapRequest(
  cleanerId: string,
  jobId: string,
  reason?: string | null
): Promise<CreateSwapRequestResult> {
  const trimmedReason = reason?.trim().slice(0, SWAP_REASON_MAX_LENGTH) || null;

  const job = await db.query.jobs.findFirst({
    where: eq(jobs.id, jobId),
    with: { cleaners: true, property: { columns: { address: true } } },
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
        "Swaps must be requested more than 24 hours before the job starts. Contact an admin to be replaced inside that window.",
    };
  }

  const swapCount = await countRecentSwapRequests(cleanerId);

  if (swapCount >= SWAP_LIMIT) {
    return {
      success: false,
      message: `You've reached the swap limit (${SWAP_LIMIT} per ${SWAP_LIMIT_WINDOW_DAYS} days).`,
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
      message: "You already have an open swap request for this job.",
    };
  }

  const { candidates, emptyReason } = await getSwapCandidates(jobId, cleanerId);

  if (candidates.length === 0) {
    return {
      success: false,
      message: `${emptyReason ?? "No eligible cleaners are available for a swap right now."} Contact an admin if you still cannot make it.`,
    };
  }

  // The offer closes at the 24-hour mark; past that the job is a replacement
  // rather than a swap.
  const expiresAt = new Date(
    job.checkInTime.getTime() - HOURS_BEFORE_JOB * 60 * 60 * 1000
  );

  const [created] = await db
    .insert(swapRequests)
    .values({
      jobId,
      originalCleanerId: cleanerId,
      status: "pending",
      expiresAt,
      reason: trimmedReason,
    })
    .returning({ id: swapRequests.id });

  const requester = await db.query.cleaners.findFirst({
    where: eq(cleaners.id, cleanerId),
    columns: { fullName: true },
  });
  const address = job.property?.address ?? "an unknown property";
  const requesterName = requester?.fullName ?? "A cleaner";
  const when = formatJobTime(job.checkInTime);

  for (const candidate of candidates) {
    await notifyCleaner({
      cleanerId: candidate.cleanerId,
      type: "swap_available",
      title: "Clean available to cover",
      message: `${firstName(requesterName)} can't work ${address} on ${when}. First to accept takes the job.`,
      jobId,
      url: "/cleaner/jobs",
    });
  }

  await notifyAdmins({
    type: "swap_requested",
    title: "Swap requested",
    message: `${requesterName} asked to be swapped off ${address} on ${when}.${
      trimmedReason ? ` Reason: ${trimmedReason}` : ""
    } ${candidates.length} cleaner(s) notified — they stay assigned until someone accepts. Override it in Job Oversight → Swap Requests.`,
    jobId,
    url: SWAP_QUEUE_URL,
  });

  return {
    success: true,
    swapRequestId: created.id,
    notifiedCount: candidates.length,
    eligibleCleanerNames: candidates.map((c) => firstName(c.fullName)),
    message: `${candidates.length} cleaner(s) were notified. The first to accept takes over — you stay assigned to this clean until then.`,
  };
}

/**
 * Withdraws a cleaner's own still-open request. Scoped to the requester so one
 * cleaner can never cancel another's.
 */
export async function cancelCleanerSwapRequest(
  cleanerId: string,
  swapRequestId: string
): Promise<{ success: true } | { success: false; message: string }> {
  const swap = await db.query.swapRequests.findFirst({
    where: eq(swapRequests.id, swapRequestId),
    columns: { id: true, jobId: true, originalCleanerId: true, status: true },
  });

  if (!swap || swap.originalCleanerId !== cleanerId) {
    return { success: false, message: "Swap request not found." };
  }

  if (swap.status !== "pending") {
    return {
      success: false,
      message: "This request is no longer open and can no longer be withdrawn.",
    };
  }

  await db
    .update(swapRequests)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(swapRequests.id, swapRequestId));

  await dismissSwapAvailableNotifications(swap.jobId);

  return { success: true };
}

export type SwapOffer = {
  swapRequestId: string;
  jobId: string;
  propertyAddress: string | null;
  checkInTime: string | null;
  originalCleanerName: string;
  reason: string | null;
};

/** Open swaps this cleaner is eligible to take over. */
export async function getOpenSwapOffers(cleanerId: string): Promise<SwapOffer[]> {
  const now = new Date();

  const open = await db.query.swapRequests.findMany({
    where: eq(swapRequests.status, "pending"),
    with: {
      job: {
        columns: { id: true, status: true, checkInTime: true },
        with: { property: { columns: { address: true } } },
      },
      originalCleaner: { columns: { fullName: true } },
    },
  });

  const offers: SwapOffer[] = [];

  for (const swap of open) {
    if (swap.originalCleanerId === cleanerId) continue;
    if (!swap.job || swap.job.status === "canceled" || swap.job.status === "completed") {
      continue;
    }
    if (swap.expiresAt.getTime() <= now.getTime()) continue;

    if (!(await canCleanerCoverSwap(cleanerId, swap.jobId, swap.originalCleanerId))) {
      continue;
    }

    offers.push({
      swapRequestId: swap.id,
      jobId: swap.jobId,
      propertyAddress: swap.job.property?.address ?? null,
      checkInTime: swap.job.checkInTime?.toISOString() ?? null,
      originalCleanerName: swap.originalCleaner?.fullName ?? "A cleaner",
      reason: swap.reason,
    });
  }

  return offers.sort((a, b) =>
    (a.checkInTime ?? "").localeCompare(b.checkInTime ?? "")
  );
}

/**
 * Takes over an open swap. First accept wins: the status transition is a
 * conditional update, so a second cleaner arriving concurrently updates zero
 * rows and is told the job is gone rather than double-booking it.
 *
 * No urgent bonus applies — a swap is always resolved more than 24 hours out.
 */
export async function acceptSwapOffer(
  cleanerId: string,
  swapRequestId: string
): Promise<{ success: true; jobId: string } | { success: false; message: string }> {
  const swap = await db.query.swapRequests.findFirst({
    where: eq(swapRequests.id, swapRequestId),
    with: {
      job: {
        columns: { id: true, status: true, checkInTime: true },
        with: { property: { columns: { address: true } } },
      },
      originalCleaner: { columns: { fullName: true } },
    },
  });

  if (!swap || swap.status !== "pending") {
    return { success: false, message: "This swap is no longer available." };
  }

  if (swap.originalCleanerId === cleanerId) {
    return { success: false, message: "You cannot take over your own swap." };
  }

  if (swap.expiresAt.getTime() <= Date.now()) {
    return {
      success: false,
      message: "This swap closed — the clean is now within 24 hours.",
    };
  }

  if (!(await canCleanerCoverSwap(cleanerId, swap.jobId, swap.originalCleanerId))) {
    return {
      success: false,
      message: "You are not eligible to cover this clean.",
    };
  }

  const address = swap.job?.property?.address ?? "the property";
  const originalName = swap.originalCleaner?.fullName ?? "The original cleaner";

  try {
    await db.transaction(async (tx) => {
      const claimed = await tx
        .update(swapRequests)
        .set({
          status: "accepted",
          replacementCleanerId: cleanerId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(swapRequests.id, swapRequestId),
            eq(swapRequests.status, "pending")
          )
        )
        .returning({ id: swapRequests.id });

      if (claimed.length === 0) {
        throw new Error("ALREADY_TAKEN");
      }

      const original = await tx.query.jobsToCleaners.findFirst({
        where: and(
          eq(jobsToCleaners.jobId, swap.jobId),
          eq(jobsToCleaners.cleanerId, swap.originalCleanerId)
        ),
      });

      if (!original) {
        throw new Error("NO_LONGER_ASSIGNED");
      }

      await tx
        .delete(jobsToCleaners)
        .where(
          and(
            eq(jobsToCleaners.jobId, swap.jobId),
            eq(jobsToCleaners.cleanerId, swap.originalCleanerId)
          )
        );

      // The replacement inherits the seat that was vacated; the designations
      // riding on it are re-derived for the new team below.
      await tx.insert(jobsToCleaners).values({
        jobId: swap.jobId,
        cleanerId,
        role: original.role,
        urgentBonus: false,
      });

      await tx
        .update(jobs)
        .set({ status: "assigned", updatedAt: new Date() })
        .where(eq(jobs.id, swap.jobId));
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "ALREADY_TAKEN") {
      return {
        success: false,
        message: "Another cleaner already accepted this swap.",
      };
    }
    if (message === "NO_LONGER_ASSIGNED") {
      return {
        success: false,
        message: "The original cleaner is no longer on this job.",
      };
    }
    throw err;
  }

  await recalculateJobRoles(swap.jobId);
  await dismissSwapAvailableNotifications(swap.jobId);

  const replacement = await db.query.cleaners.findFirst({
    where: eq(cleaners.id, cleanerId),
    columns: { fullName: true },
  });
  const when = formatJobTime(swap.job?.checkInTime ?? null);

  await notifyCleaner({
    cleanerId,
    type: "assignment",
    title: "Swap accepted",
    message: `You took over ${address} on ${when} from ${firstName(originalName)}.`,
    jobId: swap.jobId,
    url: "/cleaner/jobs",
  });

  await notifyCleaner({
    cleanerId: swap.originalCleanerId,
    type: "assignment",
    title: "Swap covered",
    message: `${replacement?.fullName ?? "Another cleaner"} took over ${address} on ${when}. You are off this job.`,
    jobId: swap.jobId,
    url: "/cleaner/jobs",
  });

  await notifyAdmins({
    type: "swap_requested",
    title: "Swap covered",
    message: `${replacement?.fullName ?? "Another cleaner"} took over ${address} on ${when} from ${originalName}.`,
    jobId: swap.jobId,
    url: SWAP_QUEUE_URL,
  });

  return { success: true, jobId: swap.jobId };
}

export type ApproveSwapResult =
  | {
      success: true;
      outcome: "backup_promoted";
      replacementCleanerName: string;
    }
  | {
      success: true;
      outcome: "released_to_pool";
      notifiedCount: number;
    }
  | { success: false; message: string };

/**
 * Admin override: take the requesting cleaner off the job now rather than
 * waiting for someone to accept the open offer.
 *
 * A pre-assigned backup is promoted straight into the seat. Otherwise the job
 * is handed to the replacement pipeline, which widens the search beyond swap
 * eligibility (roster → nearby → on-call/open pool → all eligible).
 */
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
    return { success: false, message: "Swap request is no longer open." };
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
  const backup = job.cleaners.find((c) => c.role === "backup");

  if (backup && backup.cleanerId !== originalCleanerId) {
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
      .set({ role: assignment.role, updatedAt: now })
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

    await recalculateJobRoles(swap.jobId);
    await dismissSwapAvailableNotifications(swap.jobId);

    await notifyCleaner({
      cleanerId: backup.cleanerId,
      type: "assignment",
      title: "You are now on this job",
      message: `${originalName}'s swap was approved. You have moved from backup onto ${address}.`,
      jobId: swap.jobId,
      url: "/cleaner/jobs",
    });

    await notifyCleaner({
      cleanerId: originalCleanerId,
      type: "assignment",
      title: "Swap approved",
      message: `Your swap for ${address} was approved. ${backupName} is covering this job.`,
      jobId: swap.jobId,
      url: "/cleaner/jobs",
    });

    return {
      success: true,
      outcome: "backup_promoted",
      replacementCleanerName: backupName,
    };
  }

  // No backup: close the swap and let the replacement pipeline take the job,
  // which also removes the requesting cleaner and opens it to a wider pool.
  await db
    .update(swapRequests)
    .set({ status: "cancelled", updatedAt: now })
    .where(eq(swapRequests.id, swapRequestId));

  await dismissSwapAvailableNotifications(swap.jobId);

  const result = await triggerUrgentReplacement(swap.jobId);

  await notifyCleaner({
    cleanerId: originalCleanerId,
    type: "assignment",
    title: "Swap approved",
    message: `Your swap for ${address} was approved. You're off this job while a replacement is found.`,
    jobId: swap.jobId,
    url: "/cleaner/jobs",
  });

  return {
    success: true,
    outcome: "released_to_pool",
    notifiedCount:
      result.outcome === "awaiting_accept" ? result.notifiedCount : 1,
  };
}

/** Admin override in the other direction: revoke an open swap. */
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
    return { success: false, message: "Swap request is no longer open." };
  }

  const address = swap.job?.property?.address ?? "the property";

  await db
    .update(swapRequests)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(swapRequests.id, swapRequestId));

  await dismissSwapAvailableNotifications(swap.jobId);

  await notifyCleaner({
    cleanerId: swap.originalCleanerId,
    type: "assignment",
    title: "Swap denied",
    message: `Your swap request for ${address} was denied. You remain assigned to this job.`,
    jobId: swap.jobId,
    url: "/cleaner/jobs",
  });

  return { success: true };
}

/**
 * Closes swaps nobody accepted before the 24-hour cut-off, so the requesting
 * cleaner learns they are still on the job while there is time to act.
 * Housekeeping — safe to run repeatedly.
 */
export async function expireStaleSwapRequests(
  reference = new Date()
): Promise<number> {
  const stale = await db
    .update(swapRequests)
    .set({ status: "expired", updatedAt: reference })
    .where(
      and(
        eq(swapRequests.status, "pending"),
        lt(swapRequests.expiresAt, reference)
      )
    )
    .returning({ id: swapRequests.id, jobId: swapRequests.jobId, originalCleanerId: swapRequests.originalCleanerId });

  for (const swap of stale) {
    const job = await db.query.jobs.findFirst({
      where: eq(jobs.id, swap.jobId),
      columns: { id: true },
      with: { property: { columns: { address: true } } },
    });
    const address = job?.property?.address ?? "your assigned property";

    await dismissSwapAvailableNotifications(swap.jobId);

    await notifyCleaner({
      cleanerId: swap.originalCleanerId,
      type: "assignment",
      title: "Swap not covered",
      message: `Nobody accepted your swap for ${address} before the 24-hour cut-off. You are still assigned — contact an admin if you cannot make it.`,
      jobId: swap.jobId,
      url: "/cleaner/jobs",
      sms: true,
    });

    await notifyAdmins({
      type: "swap_requested",
      title: "Swap expired uncovered",
      message: `No cleaner accepted the swap for ${address}. The original cleaner is still assigned and may need a manual replacement.`,
      jobId: swap.jobId,
      url: SWAP_QUEUE_URL,
    });
  }

  return stale.length;
}
