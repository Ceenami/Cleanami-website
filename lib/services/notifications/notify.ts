import "server-only";
import { getAppBaseUrl } from "@/lib/app-url";

import { db } from "@/db";
import { cleaners, notifications } from "@/db/schemas";
import { getCleanerUserId } from "@/lib/queries/cleaner-notifications";
import { sendPushToCleaner } from "@/lib/services/push.service";
import { sendSmsOutcome, type SmsOutcome } from "@/lib/services/sms.service";
import { eq } from "drizzle-orm";
import { recordNotificationAttempt } from "@/lib/services/notifications/notification-log";
import { cleanerNotificationUrl } from "@/lib/notifications/destination";

type CleanerNotificationType =
  | "job_reminder"
  | "photo_reminder"
  | "completion_reminder"
  | "urgent_job"
  | "payment_ready"
  | "reliability_check"
  | "swap_available"
  | "swap_requested"
  | "dispute_update"
  | "assignment"
  | "availability_reminder";

/**
 * Fan a cleaner-facing notification out across channels: always in-app; web
 * push when subscribed; SMS only when `sms: true` (time-critical). Email is
 * sent separately by the email service where relevant. Each channel degrades
 * gracefully when unconfigured.
 */
export async function notifyCleaner(input: {
  cleanerId: string;
  type: CleanerNotificationType;
  title: string;
  message: string;
  jobId?: string | null;
  url?: string;
  sms?: boolean;
  metadata?: Record<string, string>;
}): Promise<{ sms: SmsOutcome | null }> {
  const url = cleanerNotificationUrl({ ...input, metadata: { ...input.metadata, url: input.url } });
  const failures: unknown[] = [];
  let smsOutcome: SmsOutcome | null = null;
  let userId: string | null = null;
  try {
    userId = await getCleanerUserId(input.cleanerId);
    if (userId) {
      await db.insert(notifications).values({
        userId,
        type: input.type,
        title: input.title,
        message: input.message,
        jobId: input.jobId ?? null,
        metadata: { ...input.metadata, source: "notify", url },
      });
      await recordNotificationAttempt({
        channel: "in_app",
        status: "sent",
        meta: {
          trigger: input.type,
          userId,
          jobId: input.jobId ?? null,
          recipient: userId,
        },
      });
    } else {
      // A cleaner with no linked user row gets no in-app notification at all,
      // and used to get it silently. This is the row that says so.
      await recordNotificationAttempt({
        channel: "in_app",
        status: "skipped",
        error: "no user row linked to this cleaner",
        meta: {
          trigger: input.type,
          jobId: input.jobId ?? null,
          recipient: input.cleanerId,
        },
      });
    }
  } catch (error) {
    failures.push(error);
    await recordNotificationAttempt({
      channel: "in_app", status: "failed", error,
      meta: { trigger: input.type, userId, jobId: input.jobId, recipient: input.cleanerId }
    });
  }

  // Web push (no-op if VAPID/subscriptions absent).
  try {
    await sendPushToCleaner(
      input.cleanerId,
      {
        title: input.title,
        body: input.message,
        url: url ?? "/cleaner/jobs",
      },
      { trigger: input.type, jobId: input.jobId ?? null },
      { throwOnFailure: true },
    );
  } catch (error) {
    failures.push(error);
    await recordNotificationAttempt({
      channel: "push", status: "failed", error,
      meta: { trigger: input.type, userId, jobId: input.jobId, recipient: input.cleanerId }
    });
  }

  // SMS for time-critical alerts only.
  if (input.sms) {
    try {
      const cleaner = await db.query.cleaners.findFirst({
        where: eq(cleaners.id, input.cleanerId),
        columns: { phone: true },
      });
      const link = url ? `${getAppBaseUrl()}${url}` : null;
      const message = `${input.title}: ${input.message}${link ? ` View: ${link}` : ""}`;
      smsOutcome = await sendSmsOutcome(cleaner?.phone, message, {
        cleanerId: input.cleanerId,
        trigger: input.type,
        userId,
        jobId: input.jobId ?? null,
      });
      if (smsOutcome.status === "failed" || smsOutcome.status === "unknown") {
        failures.push(new Error(`SMS ${smsOutcome.status}; inspect channel log before retrying`));
      }
    } catch (error) {
      failures.push(error);
      await recordNotificationAttempt({
        channel: "sms", status: "failed", error,
        meta: { trigger: input.type, userId, jobId: input.jobId, recipient: input.cleanerId }
      });
    }
  }
  // Attempt every channel, while preserving failure visibility for dispatch callers.
  if (failures.length) throw new AggregateError(failures, "Notification dispatch failed");
  return { sms: smsOutcome };
}
