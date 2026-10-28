// Shared disclosure: the saved record must match the text shown to contractors.
export const SMS_CONSENT_VERSION = "2026-10-28";
export const SMS_CONSENT_TEXT =
  "I agree to receive recurring operational SMS messages from CleanNami LLC about cleaner availability, assignments, confirmations, reminders, and scheduling changes.";
export const SMS_CONSENT_DETAILS =
  "Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help. SMS consent is optional.";
export const SMS_CONSENT_LINK_TEXT = "See our SMS Terms and Privacy Policy.";
export const SMS_TERMS_PATH = "/sms-terms";
export const PRIVACY_POLICY_PATH = "/privacy-policy";

/** Accept US local formatting or explicit international E.164 numbers. */
export function normalizeSmsPhone(value: string | null | undefined): string | null {
  if (!value || !/^\+?[\d\s().-]+$/.test(value.trim())) return null;
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    return /^\+[1-9]\d{7,14}$/.test(`+${digits}`) ? `+${digits}` : null;
  }
  if (/^[2-9]\d{9}$/.test(digits)) return `+1${digits}`;
  if (/^1[2-9]\d{9}$/.test(digits)) return `+${digits}`;
  return null;
}
