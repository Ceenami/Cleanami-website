import "server-only";

import twilio from "twilio";

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
  body: string
): Promise<boolean> {
  const client = getTwilio();
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!client || !from || !to) return false;

  try {
    await client.messages.create({ to, from, body });
    return true;
  } catch (error) {
    console.error("[sms.service] send failed:", error);
    return false;
  }
}
