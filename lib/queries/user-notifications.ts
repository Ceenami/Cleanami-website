import "server-only";

import { db } from "@/db";
import { notifications, users } from "@/db/schemas";
import { and, desc, eq } from "drizzle-orm";

export type UserNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  jobId: string | null;
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

  const rows = await db.query.notifications.findMany({
    where: eq(notifications.userId, userId),
    orderBy: [desc(notifications.createdAt)],
    limit,
  });

  const mapped = rows.map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    message: n.message,
    isRead: n.isRead,
    createdAt: n.createdAt.toISOString(),
    jobId: n.jobId,
  }));

  return {
    notifications: mapped,
    unreadCount: mapped.filter((n) => !n.isRead).length,
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
        eq(notifications.userId, userId)
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
      and(eq(notifications.userId, userId), eq(notifications.isRead, false))
    );
}
