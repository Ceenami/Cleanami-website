import "server-only";

import { db } from "@/db";
import { jobs, notifications, users } from "@/db/schemas";
import { and, count, desc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { adminNotificationUrl } from "@/lib/notifications/destination";

export type UserNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  jobId: string | null;
  /** In-app destination for the notification, when it has one. */
  url: string | null;
};

async function resolveAppUserId(
  supabaseUserId: string,
  email?: string,
  role?: string
): Promise<string | null> {
  const existing = await db.query.users.findFirst({
    where: eq(users.supabaseUserId, supabaseUserId),
    columns: { id: true },
  });

  if (existing) return existing.id;

  if (!email) return null;

  const normalizedEmail = email.toLowerCase();
  const byEmail = await db.query.users.findFirst({
    where: eq(users.email, normalizedEmail),
    columns: { id: true },
  });

  if (byEmail) {
    await db
      .update(users)
      .set({ supabaseUserId, updatedAt: new Date() })
      .where(eq(users.id, byEmail.id));
    return byEmail.id;
  }

  if (!role) return null;

  const [inserted] = await db
    .insert(users)
    .values({
      supabaseUserId,
      email: normalizedEmail,
      role,
      name: normalizedEmail.split("@")[0],
    })
    .returning({ id: users.id });

  return inserted?.id ?? null;
}

export async function getUserNotificationsBySupabaseId(
  supabaseUserId: string,
  options?: { email?: string; role?: string; limit?: number }
): Promise<{ notifications: UserNotification[]; unreadCount: number }> {
  const limit = options?.limit ?? 50;

  const userId = await resolveAppUserId(
    supabaseUserId,
    options?.email,
    options?.role
  );

  if (!userId) {
    return { notifications: [], unreadCount: 0 };
  }

  const visible = and(
    eq(notifications.userId, userId),
    or(isNull(notifications.scheduledFor), lte(notifications.scheduledFor, new Date()))
  );
  const rows = await db.query.notifications.findMany({
    where: visible,
    orderBy: [desc(notifications.createdAt)],
    limit,
  });

  // Legacy restock alerts have only a job ID. Resolve property destinations in
  // one scoped batch; keep old records intact and deleted jobs on the safe queue.
  const restockJobIds = [...new Set(rows.filter(n => n.metadata?.source === "restock_request" && !n.metadata?.propertyId && n.jobId).map(n => n.jobId!))];
  const restockJobs = restockJobIds.length ? await db.select({ id: jobs.id, propertyId: jobs.propertyId }).from(jobs).where(inArray(jobs.id, restockJobIds)) : [];
  const restockProperties = new Map(restockJobs.map(j => [j.id, j.propertyId]));
  const mapped = rows.map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    message: n.message,
    isRead: n.isRead,
    createdAt: n.createdAt.toISOString(),
    jobId: n.jobId,
    url: adminNotificationUrl(n.metadata?.source === "restock_request" && !n.metadata?.propertyId ? { ...n, metadata: { ...n.metadata, propertyId: n.jobId ? restockProperties.get(n.jobId) : null } } : n),
  }));

  // The badge counts the whole inbox, not just the first page. Keep DB reads sequential.
  const [unread] = await db.select({ total: count() }).from(notifications)
    .where(and(visible, eq(notifications.isRead, false)));

  return {
    notifications: mapped,
    unreadCount: unread.total,
  };
}

export async function markUserNotificationRead(
  supabaseUserId: string,
  notificationId: string,
  options?: { email?: string; role?: string }
): Promise<boolean> {
  const userId = await resolveAppUserId(
    supabaseUserId,
    options?.email,
    options?.role
  );

  if (!userId) return false;

  const result = await db
    .update(notifications)
    .set({ isRead: true })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.userId, userId),
        or(isNull(notifications.scheduledFor), lte(notifications.scheduledFor, new Date()))
      )
    )
    .returning({ id: notifications.id });

  return result.length > 0;
}

export async function markAllUserNotificationsRead(
  supabaseUserId: string,
  options?: { email?: string; role?: string }
): Promise<void> {
  const userId = await resolveAppUserId(
    supabaseUserId,
    options?.email,
    options?.role
  );

  if (!userId) return;

  await db
    .update(notifications)
    .set({ isRead: true })
    .where(
      and(eq(notifications.userId, userId), eq(notifications.isRead, false),
        or(isNull(notifications.scheduledFor), lte(notifications.scheduledFor, new Date())))
    );
}
