import "server-only";

import { db } from "@/db";
import { notifications, users } from "@/db/schemas";
import { inArray } from "drizzle-orm";
import { sendAdminAlertEmail } from "@/lib/services/email.service";

type AdminNotificationType =
  | "swap_requested"
  | "dispute_update"
  | "assignment"
  /** 0036 — a new residential booking. Needs that migration applied first. */
  | "booking_alert";

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
  /**
   * Also send an email to each admin.
   *
   * Off by default, and it should stay that way for most events. The spec says
   * email is "also used for admin alerts", and
   * F-11 records that `notifyAdmins` never honoured it — but an email per
   * routine event is how an alert channel becomes noise nobody reads.
   *
   * Reserved for the **time-sensitive** triggers, where an in-app row nobody
   * happens to be looking at is not an alert. Two triggers qualified;
   * deleted one of them along with the under-48h review queue, so in 2A this is
   * used by exactly one caller: "the engine could not staff this clean".
   */
  email?: boolean;
}): Promise<number> {
  try {
    const admins = await db.query.users.findMany({
      where: inArray(users.role, ["admin", "super_admin"]),
      columns: { id: true, email: true, name: true },
    });

    // A silent zero-admin fan-out looks exactly like a working one, which is
    // why this is logged rather than returned quietly.
    if (admins.length === 0) {
      console.warn("[notifyAdmins] no admin users found; nothing was sent");
      return 0;
    }

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

    if (input.email) {
      // One at a time. `sendAdminAlertEmail` is a network call, not a DB query,
      // but the loop stays sequential so a slow provider cannot open N
      // simultaneous requests per event.
      for (const admin of admins) {
        if (!admin.email) continue;
        try {
          await sendAdminAlertEmail({
            to: admin.email,
            name: admin.name ?? undefined,
            subject: input.title,
            message: input.message,
            url: input.url ?? undefined,
          });
        } catch (err) {
          console.error("[notifyAdmins] admin email failed:", err);
        }
      }
    }

    return admins.length;
  } catch (error) {
    console.error("[notifyAdmins]", error);
    return 0;
  }
}
