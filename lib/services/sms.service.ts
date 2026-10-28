import "server-only";

import twilio from "twilio";
import { db } from "@/db";
import { cleaners } from "@/db/schemas";
import { eq } from "drizzle-orm";
import { normalizeSmsPhone } from "@/lib/sms/consent";
import { getCleanerSmsConsentState } from "@/lib/services/cleaner-sms-consent";

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
  meta: NotificationMeta & { cleanerId: string }
): Promise<boolean> {
  const client = getTwilio();
  const from = process.env.TWILIO_FROM_NUMBER;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const logMeta: NotificationMeta = {
    trigger: "sms",
    ...meta,
    recipient: to ?? null,
  };

  // Three different reasons for the same silence, and the log tells them
  // apart: no Twilio credentials, no from-number, or a cleaner with no phone
  // on file. The third is an operational problem and the first two are not.
  if (!client || (!from && !messagingServiceSid) || !to) {
    await recordNotificationAttempt({
      channel: "sms",
      status: "skipped",
      error: !client
        ? "Twilio is not configured"
        : !from && !messagingServiceSid
          ? "No Twilio sender is configured"
          : "no phone number on file for this recipient",
      meta: logMeta,
    });
    return false;
  }

  try {
    const normalized = normalizeSmsPhone(to);
    const [cleaner] = await db.select({ phone: cleaners.phone }).from(cleaners)
      .where(eq(cleaners.id, meta.cleanerId)).limit(1);
    const consent = await getCleanerSmsConsentState(meta.cleanerId, cleaner?.phone ?? null);
    if (!normalized || normalized !== consent.phone || !consent.canSend) {
      await recordNotificationAttempt({
        channel: "sms", status: "skipped",
        error: "No current SMS consent for this number, or carrier opt-out is active",
        meta: logMeta,
      });
      return false;
    }
    await client.messages.create({
      to: normalized,
      ...(messagingServiceSid ? { messagingServiceSid } : { from }),
      body: `CleanNami: ${body}\nReply STOP to opt out or HELP for help.`,
    });
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
