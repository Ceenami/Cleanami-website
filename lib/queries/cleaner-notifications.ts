import "server-only";

import { db } from "@/db";
import { cleaners, notifications, swapRequests, users } from "@/db/schemas";
import { getClaimableUrgentJobIds } from "@/lib/services/urgent-replacement.service";
import {
  and,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { cleanerNotificationUrl } from "@/lib/notifications/destination";
import { recordNotificationAttempt } from "@/lib/services/notifications/notification-log";

export type CleanerNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  jobId: string | null;
  url: string | null;
};

export async function getCleanerUserId(
  cleanerId: string,
): Promise<string | null> {
  const cleaner = await db.query.cleaners.findFirst({
    where: eq(cleaners.id, cleanerId),
    columns: { userId: true },
  });
  return cleaner?.userId ?? null;
}

export async function getCleanerNotifications(
  cleanerId: string,
  limit = 20,
): Promise<{ notifications: CleanerNotification[]; unreadCount: number }> {
  const userId = await getCleanerUserId(cleanerId);
  if (!userId) {
    return { notifications: [], unreadCount: 0 };
  }

  const due = and(
    eq(notifications.userId, userId),
    or(
      isNull(notifications.scheduledFor),
      lte(notifications.scheduledFor, new Date()),
    ),
  );
  const offers = await db.query.notifications.findMany({
    where: and(
      due,
      inArray(notifications.type, ["swap_available", "swap_requested"]),
    ),
    columns: { jobId: true },
  });
  const offeredJobIds = [
    ...new Set(offers.flatMap((n) => (n.jobId ? [n.jobId] : []))),
  ];
  const claimableJobIds = await getClaimableUrgentJobIds(offeredJobIds);
  const pendingSwaps = offeredJobIds.length
    ? await db.query.swapRequests.findMany({
        where: and(
          inArray(swapRequests.jobId, offeredJobIds),
          eq(swapRequests.status, "pending"),
          gt(swapRequests.expiresAt, new Date()),
        ),
        columns: { jobId: true, originalCleanerId: true },
        with: { job: { columns: { status: true } } },
      })
    : [];
  // These notices lead to the swap list, whose API rechecks current eligibility.
  const pendingJobIds = pendingSwaps
    .filter(
      (s) => s.originalCleanerId !== cleanerId && s.job?.status === "assigned",
    )
    .map((s) => s.jobId);
  const visible = and(
    due,
    or(
      notInArray(notifications.type, ["swap_available", "swap_requested"]),
      and(
        eq(notifications.type, "swap_available"),
        claimableJobIds.size
          ? inArray(notifications.jobId, [...claimableJobIds])
          : sql`false`,
      ),
      pendingJobIds.length
        ? inArray(notifications.jobId, pendingJobIds)
        : sql`false`,
    ),
  );
  // Filter expired offers before pagination; DB queries must stay sequential.
  const rows =
    limit > 0
      ? await db.query.notifications.findMany({
          where: visible,
          orderBy: [desc(notifications.createdAt)],
          limit,
        })
      : [];
  const [unread] = await db
    .select({ total: count() })
    .from(notifications)
    .where(and(visible, eq(notifications.isRead, false)));

  return {
    notifications: rows.map((n) => ({
      id: n.id,
      // Older normal offers used swap_available too. Never give those an urgent-accept action.
      type:
        n.type === "swap_available" &&
        (!n.jobId || !claimableJobIds.has(n.jobId))
          ? "swap_requested"
          : n.type,
      title: n.title,
      message: n.message,
      isRead: n.isRead,
      createdAt: n.createdAt.toISOString(),
      jobId: n.jobId,
      url: cleanerNotificationUrl(n),
    })),
    unreadCount: unread.total,
  };
}

export async function markAllNotificationsRead(cleanerId: string) {
  const userId = await getCleanerUserId(cleanerId);
  if (!userId) return;

  await db
    .update(notifications)
    .set({ isRead: true })
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.isRead, false),
        or(
          isNull(notifications.scheduledFor),
          lte(notifications.scheduledFor, new Date()),
        ),
      ),
    );
}

export async function getUnreadNotificationCount(
  cleanerId: string,
): Promise<number> {
  return (await getCleanerNotifications(cleanerId, 0)).unreadCount;
}

export async function notifyAdminsOfDispute(
  cleanerName: string,
  disputeType: string,
) {
  const admins = await db
    .select({ id: users.id })
    .from(users)
    .where(or(eq(users.role, "admin"), eq(users.role, "super_admin")));

  if (admins.length === 0) return;

  await db.insert(notifications).values(
    admins.map((admin) => ({
      userId: admin.id,
      type: "urgent_job" as const,
      title: "New cleaner dispute",
      message: `${cleanerName} submitted a ${disputeType.replace("_", " ")} dispute.`,
      metadata: { source: "cleaner_dispute", url: "/admin/disputes" },
    })),
  );
}

/**
 * Alert admins that a cleaner has asked for supplies (task 1.16).
 *
 * Reuses the `urgent_job` notification type the way `notifyAdminsOfDispute`
 * does — the enum has no `restock` member, and adding one means an
 * `ALTER TYPE ... ADD VALUE` migration for a label. `metadata.source`
 * distinguishes it.
 */
export async function notifyAdminsOfRestockRequest(input: {
  cleanerName: string;
  propertyAddress: string;
  item: string;
  quantity: number;
  urgency: string;
  jobId: string | null;
  propertyId?: string;
  requestId?: string;
}): Promise<number> {
  const admins = await db
    .select({ id: users.id })
    .from(users)
    .where(or(eq(users.role, "admin"), eq(users.role, "super_admin")));

  if (admins.length === 0) {
    await recordNotificationAttempt({
      channel: "in_app",
      status: "skipped",
      error: "no admin users exist",
      meta: { trigger: "restock_request", jobId: input.jobId },
    });
    return 0;
  }

  const urgencyPrefix = input.urgency === "urgent" ? "URGENT: " : "";

  await db.insert(notifications).values(
    admins.map((admin) => ({
      userId: admin.id,
      type: "urgent_job" as const,
      title: `${urgencyPrefix}Restock request`,
      message: `${input.cleanerName} requested ${input.quantity} × ${input.item} for ${input.propertyAddress}.`,
      jobId: input.jobId,
      metadata: {
        source: "restock_request",
        urgency: input.urgency,
        propertyId: input.propertyId,
        requestId: input.requestId,
        url: input.propertyId
          ? `/admin/restocking/${input.propertyId}${input.requestId ? `?requestId=${input.requestId}` : ""}`
          : "/admin/restocking",
      },
    })),
  );
  for (const admin of admins)
    await recordNotificationAttempt({
      channel: "in_app",
      status: "sent",
      meta: {
        trigger: "restock_request",
        userId: admin.id,
        jobId: input.jobId,
        recipient: admin.id,
      },
    });
  return admins.length;
}

export async function notifyAdminsOfJobAlert(input: {
  title: string;
  message: string;
  jobId: string;
  outcome: string;
}) {
  const admins = await db
    .select({ id: users.id })
    .from(users)
    .where(or(eq(users.role, "admin"), eq(users.role, "super_admin")));

  if (admins.length === 0) return;

  await db.insert(notifications).values(
    admins.map((admin) => ({
      userId: admin.id,
      type: "completion_reminder" as const,
      title: input.title,
      message: input.message,
      jobId: input.jobId,
      metadata: {
        source: "job_reconciliation",
        outcome: input.outcome,
        url: `/admin/job-oversight/${input.jobId}`,
      },
    })),
  );
}
