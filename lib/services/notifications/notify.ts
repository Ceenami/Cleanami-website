import "server-only";

import { db } from "@/db";
import { cleaners, notifications } from "@/db/schemas";
import { getCleanerUserId } from "@/lib/queries/cleaner-notifications";
import { sendPushToCleaner } from "@/lib/services/push.service";
import { sendSms } from "@/lib/services/sms.service";
import { eq } from "drizzle-orm";

type CleanerNotificationType =
  | "job_reminder"
  | "photo_reminder"
  | "completion_reminder"
  | "urgent_job"
  | "payment_ready"
  | "reliability_check"
  | "swap_available"
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
}): Promise<void> {
  const userId = await getCleanerUserId(input.cleanerId);
  if (userId) {
    await db.insert(notifications).values({
      userId,
      type: input.type,
      title: input.title,
      message: input.message,
      jobId: input.jobId ?? null,
      metadata: { source: "notify" },
    });
  }

  // Web push (no-op if VAPID/subscriptions absent).
  await sendPushToCleaner(input.cleanerId, {
    title: input.title,
    body: input.message,
    url: input.url ?? "/cleaner/jobs",
  });

  // SMS for time-critical alerts only.
  if (input.sms) {
    const cleaner = await db.query.cleaners.findFirst({
      where: eq(cleaners.id, input.cleanerId),
      columns: { phone: true },
    });
    await sendSms(cleaner?.phone, `${input.title}: ${input.message}`);
  }
}
