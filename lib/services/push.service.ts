import "server-only";

import webpush from "web-push";
import { db } from "@/db";
import { pushNotificationTokens } from "@/db/schemas";
import { eq } from "drizzle-orm";

let configured: boolean | undefined;

/** Configure web-push with VAPID keys once; false if env is missing (no-op). */
function ensureConfigured(): boolean {
  if (configured !== undefined) return configured;

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:booking@cleanami.ceenami.com";

  if (!publicKey || !privateKey) {
    configured = false;
    return false;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

import {
  recordNotificationAttempt,
  type NotificationMeta,
} from "@/lib/services/notifications/notification-log";

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
};

/**
 * Send a web-push notification to all of a cleaner's registered devices.
 * No-ops when VAPID is unconfigured. Prunes tokens the browser has expired.
 */
export async function sendPushToCleaner(
  cleanerId: string,
  payload: PushPayload,
  meta?: NotificationMeta
): Promise<number> {
  const logMeta: NotificationMeta = {
    trigger: "push",
    ...meta,
    // The cleaner id, not a device token. A push "recipient" is a set of
    // browser subscriptions, and the useful identity is the person.
    recipient: cleanerId,
  };

  if (!ensureConfigured()) {
    await recordNotificationAttempt({
      channel: "push",
      status: "skipped",
      error: "web push (VAPID) is not configured",
      meta: logMeta,
    });
    return 0;
  }

  const tokens = await db
    .select({ id: pushNotificationTokens.id, token: pushNotificationTokens.token })
    .from(pushNotificationTokens)
    .where(eq(pushNotificationTokens.cleanerId, cleanerId));

  // No subscription is not a failure - the cleaner simply has not enabled
  // push on any device - but it is worth telling apart from a delivery error.
  if (tokens.length === 0) {
    await recordNotificationAttempt({
      channel: "push",
      status: "skipped",
      error: "no push subscription registered for this cleaner",
      meta: logMeta,
    });
    return 0;
  }

  let sent = 0;
  let lastError: unknown = null;
  for (const row of tokens) {
    let subscription: webpush.PushSubscription;
    try {
      subscription = JSON.parse(row.token) as webpush.PushSubscription;
    } catch {
      continue;
    }

    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload));
      sent += 1;
    } catch (error: unknown) {
      // 404/410 means the subscription is gone — remove it.
      const statusCode =
        typeof error === "object" && error && "statusCode" in error
          ? (error as { statusCode?: number }).statusCode
          : undefined;
      if (statusCode === 404 || statusCode === 410) {
        await db
          .delete(pushNotificationTokens)
          .where(eq(pushNotificationTokens.id, row.id));
      } else {
        console.error("[push.service] send failed:", error);
        lastError = error;
      }
    }
  }

  // One row per call rather than per device: the question this table answers
  // is "did this notification go out", and a cleaner with three browsers is
  // still one notification.
  await recordNotificationAttempt({
    channel: "push",
    status: sent > 0 ? "sent" : "failed",
    error:
      sent > 0
        ? null
        : (lastError ?? "every registered subscription was expired or rejected"),
    meta: logMeta,
  });

  return sent;
}
