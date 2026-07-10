import "server-only";

import { db } from "@/db";
import { cleaners, notifications, users } from "@/db/schemas";
import { getClaimableUrgentJobIds } from "@/lib/services/urgent-replacement.service";
import { and, desc, eq, or } from "drizzle-orm";

export type CleanerNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  jobId: string | null;
};

export async function getCleanerUserId(cleanerId: string): Promise<string | null> {
  const cleaner = await db.query.cleaners.findFirst({
    where: eq(cleaners.id, cleanerId),
    columns: { userId: true },
  });
  return cleaner?.userId ?? null;
}

export async function getCleanerNotifications(
  cleanerId: string,
  limit = 20
): Promise<{ notifications: CleanerNotification[]; unreadCount: number }> {
  const userId = await getCleanerUserId(cleanerId);
  if (!userId) {
    return { notifications: [], unreadCount: 0 };
  }

  const rows = await db.query.notifications.findMany({
    where: eq(notifications.userId, userId),
    orderBy: [desc(notifications.createdAt)],
    limit,
  });

  const swapJobIds = rows
    .filter((n) => n.type === "swap_available" && n.jobId)
    .map((n) => n.jobId as string);

  const claimableJobIds = await getClaimableUrgentJobIds(swapJobIds);

  const visibleRows = rows.filter((n) => {
    if (n.type === "swap_available" && n.jobId) {
      return claimableJobIds.has(n.jobId);
    }
    return true;
  });

  const unreadCount = visibleRows.filter((n) => !n.isRead).length;

  return {
    notifications: visibleRows.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      message: n.message,
      isRead: n.isRead,
      createdAt: n.createdAt.toISOString(),
      jobId: n.jobId,
    })),
    unreadCount,
  };
}

export async function markAllNotificationsRead(cleanerId: string) {
  const userId = await getCleanerUserId(cleanerId);
  if (!userId) return;

  await db
    .update(notifications)
    .set({ isRead: true })
    .where(
      and(eq(notifications.userId, userId), eq(notifications.isRead, false))
    );
}

export async function getUnreadNotificationCount(
  cleanerId: string
): Promise<number> {
  const userId = await getCleanerUserId(cleanerId);
  if (!userId) return 0;

  const rows = await db.query.notifications.findMany({
    where: and(
      eq(notifications.userId, userId),
      eq(notifications.isRead, false)
    ),
    columns: { id: true },
  });

  return rows.length;
}

export async function notifyAdminsOfDispute(
  cleanerName: string,
  disputeType: string
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
      metadata: { source: "cleaner_dispute" },
    }))
  );
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
      },
    }))
  );
}
