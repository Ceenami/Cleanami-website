import "server-only";

import twilio from "twilio";

import {
  recordNotificationAttempt,
  type NotificationMeta,
} from "@/lib/services/notifications/notification-log";

type TwilioClient = ReturnType<typeof twilio>;

let cached: TwilioClient | null | undefined;

/** Lazily build a Twilio client; returns null if env is unconfigured (no-op). */
export function getTwilio(): TwilioClient | null {
  if (cached !== undefined) return cached;

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    cached = null;
    return null;
  }
  cached = twilio(sid, token);
  return cached;
}

/**
 * Send a time-critical SMS. Silently no-ops (returns false) when Twilio or the
 * from-number is not configured, or the recipient has no phone — matching the
 * app's graceful-degradation pattern for optional providers.
 */
export async function sendSms(
  to: string | null | undefined,
  body: string,
  meta?: NotificationMeta
): Promise<boolean> {
  const client = getTwilio();
  const from = process.env.TWILIO_FROM_NUMBER;
  const logMeta: NotificationMeta = {
    trigger: "sms",
    ...meta,
    recipient: to ?? null,
  };

  // Three different reasons for the same silence, and the log tells them
  // apart: no Twilio credentials, no from-number, or a cleaner with no phone
  // on file. The third is an operational problem and the first two are not.
  if (!client || !from || !to) {
    await recordNotificationAttempt({
      channel: "sms",
      status: "skipped",
      error: !client
        ? "Twilio is not configured"
        : !from
          ? "TWILIO_FROM_NUMBER is not set"
          : "no phone number on file for this recipient",
      meta: logMeta,
    });
    return false;
  }

  try {
    await client.messages.create({ to, from, body });
    await recordNotificationAttempt({
      channel: "sms",
      status: "sent",
      meta: logMeta,
    });
    return true;
  } catch (error) {
    console.error("[sms.service] send failed:", error);
    await recordNotificationAttempt({
      channel: "sms",
      status: "failed",
      error,
      meta: logMeta,
    });
    return false;
  }
}
