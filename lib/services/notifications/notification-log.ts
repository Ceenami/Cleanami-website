import "server-only";

import { db } from "@/db";
import {
  notificationLog,
  type NOTIFICATION_CHANNELS,
  type NOTIFICATION_SEND_STATUSES,
} from "@/db/schemas";

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export type NotificationSendStatus = (typeof NOTIFICATION_SEND_STATUSES)[number];

/**
 * Context a caller may attach to a send so the log row is worth reading.
 *
 * Optional throughout. A send that arrives without a trigger still produces a
 * row — with a generic trigger — because a row that says "something sent an
 * email and did not say what" is still a better answer than silence.
 */
export type NotificationMeta = {
  trigger?: string;
  userId?: string | null;
  jobId?: string | null;
  /** Address, phone number or user id. Never a message body. */
  recipient?: string | null;
};

/**
 * A provider's error text can be long and is occasionally a whole HTML page.
 * The log is for answering "did this send", not for storing a stack trace.
 */
const MAX_ERROR_LENGTH = 500;

function trimError(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  const text =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : JSON.stringify(error);
  if (!text) return null;
  return text.length > MAX_ERROR_LENGTH
    ? `${text.slice(0, MAX_ERROR_LENGTH)}…`
    : text;
}

/**
 * Record one notification attempt. Never throws.
 *
 * This is deliberately the weakest link in the chain: a notification must never
 * fail because its bookkeeping failed, and an action — a booking, an
 * assignment, a capture — must never fail because a notification did. So every
 * error here is swallowed after being logged to the console, and the caller is
 * given no way to find out.
 *
 * Call it from inside the channel services, never from the ~30 places that ask
 * for a notification. A call site can be added without a log line and nobody
 * would notice; a channel service cannot.
 *
 * `provider_message_id` is deliberately left null for this phase. Populating it
 * only matters alongside a delivery webhook, and delivery confirmation is a
 * separate, costed decision — the column exists so that decision stays cheap.
 */
export async function recordNotificationAttempt(entry: {
  channel: NotificationChannel;
  status: NotificationSendStatus;
  /** Never a message body, and never anything derived from entry instructions. */
  error?: unknown;
  meta?: NotificationMeta;
}): Promise<void> {
  try {
    await db.insert(notificationLog).values({
      channel: entry.channel,
      trigger: entry.meta?.trigger ?? `${entry.channel}_unspecified`,
      recipient: entry.meta?.recipient ?? null,
      userId: entry.meta?.userId ?? null,
      jobId: entry.meta?.jobId ?? null,
      status: entry.status,
      error: trimError(entry.error),
    });
  } catch (err) {
    // The one place this is allowed to fail quietly. If the log is broken, the
    // notification still went out and the action still happened.
    console.error("[notification-log] could not record an attempt", err);
  }
}
