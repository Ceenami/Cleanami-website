import "server-only";

import { db } from "@/db";
import { notifications, users } from "@/db/schemas";
import { inArray } from "drizzle-orm";

type AdminNotificationType = "swap_requested" | "dispute_update" | "assignment";

/**
 * Writes one notification row per admin.
 *
 * The header bell and `/admin/notifications` both read `notifications` scoped
 * to the signed-in user, so an event with no admin-addressed row is invisible
 * on the admin side no matter what it wrote elsewhere.
 *
 * Best-effort by design: callers are user-facing actions that must not fail
 * because a notification could not be recorded.
 */
export async function notifyAdmins(input: {
  type: AdminNotificationType;
  title: string;
  message: string;
  jobId?: string | null;
  /** In-app destination rendered as a "View" link on the notification. */
  url?: string;
}): Promise<number> {
  try {
    const admins = await db.query.users.findMany({
      where: inArray(users.role, ["admin", "super_admin"]),
      columns: { id: true },
    });

    if (admins.length === 0) return 0;

    await db.insert(notifications).values(
      admins.map((admin) => ({
        userId: admin.id,
        type: input.type,
        title: input.title,
        message: input.message,
        jobId: input.jobId ?? null,
        metadata: { source: "admin_alert", url: input.url ?? null },
      }))
    );

    return admins.length;
  } catch (error) {
    console.error("[notifyAdmins]", error);
    return 0;
  }
}
