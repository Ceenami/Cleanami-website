import "server-only";

import { db } from "@/db";
import { cleanerSmsConsentEvents as events, cleaners } from "@/db/schemas";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  normalizeSmsPhone, SMS_CONSENT_VERSION, SMS_CONSENT_TEXT,
  SMS_CONSENT_DETAILS, SMS_CONSENT_LINK_TEXT, SMS_TERMS_PATH, PRIVACY_POLICY_PATH,
} from "@/lib/sms/consent";

export class SmsConsentInputError extends Error {}

export async function getCleanerSmsConsentState(cleanerId: string, phone: string | null) {
  const normalized = normalizeSmsPhone(phone);
  const [consent] = await db.select().from(events).where(and(
    eq(events.cleanerId, cleanerId),
    inArray(events.eventType, ["consent_granted", "consent_imported", "consent_withdrawn"]),
  )).orderBy(desc(events.id)).limit(1);
  // Sequential queries: the production transaction pooler cannot pipeline these.
  const [carrier] = normalized ? await db.select().from(events).where(and(
    eq(events.phone, normalized),
    inArray(events.eventType, ["carrier_stop", "carrier_start"]),
  )).orderBy(desc(events.id)).limit(1) : [];
  const optedIn = Boolean(normalized && consent?.phone === normalized &&
    (consent.eventType === "consent_granted" || consent.eventType === "consent_imported"));
  const carrierBlocked = carrier?.eventType === "carrier_stop";
  return { optedIn, carrierBlocked, canSend: optedIn && !carrierBlocked, phone: normalized };
}

export async function saveCleanerSmsConsent(input: {
  cleanerId: string;
  phone: string;
  optedIn: boolean;
  disclosureVersion?: string;
  source: "onboarding" | "profile";
  phoneToSave?: string;
}) {
  if (input.optedIn && input.disclosureVersion !== SMS_CONSENT_VERSION) {
    throw new SmsConsentInputError("Please reload the SMS consent form and review the current terms.");
  }
  const normalized = normalizeSmsPhone(input.phone);
  if (input.optedIn && !normalized) {
    throw new SmsConsentInputError("Enter a valid mobile number, including the country code for numbers outside the US.");
  }
  // Serialize against other consent saves; consent must match the saved number.
  await db.transaction(async (tx) => {
    const [cleaner] = await tx.select({ phone: cleaners.phone }).from(cleaners)
      .where(eq(cleaners.id, input.cleanerId)).for("update");
    if (!cleaner) throw new SmsConsentInputError("Cleaner not found.");
    if (input.phoneToSave !== undefined && input.source === "onboarding") {
      await tx.update(cleaners).set({ phone: input.phoneToSave, updatedAt: new Date() })
        .where(eq(cleaners.id, input.cleanerId));
    } else if (normalized !== normalizeSmsPhone(cleaner.phone)) {
      throw new SmsConsentInputError("Your phone number changed. Reload and review your SMS preference.");
    }
    const [previous] = await tx.select().from(events).where(and(
      eq(events.cleanerId, input.cleanerId),
      inArray(events.eventType, ["consent_granted", "consent_imported", "consent_withdrawn"]),
    )).orderBy(desc(events.id)).limit(1);
    const phone = normalized ?? previous?.phone;
    if (!phone) return; // No valid phone and no consent to withdraw.
    const eventType = input.optedIn ? "consent_granted" : "consent_withdrawn";
    if (previous?.phone === phone && previous.eventType === eventType &&
      (!input.optedIn || previous.disclosureVersion === SMS_CONSENT_VERSION)) return;
    await tx.insert(events).values({
      cleanerId: input.cleanerId, phone, eventType, source: input.source,
      disclosureVersion: input.optedIn ? SMS_CONSENT_VERSION : null,
      disclosureText: input.optedIn ? `${SMS_CONSENT_TEXT}\n${SMS_CONSENT_DETAILS}\n${SMS_CONSENT_LINK_TEXT}` : null,
      termsUrl: input.optedIn ? SMS_TERMS_PATH : null,
      privacyUrl: input.optedIn ? PRIVACY_POLICY_PATH : null,
    });
  });
}

export async function recordCarrierSmsPreference(phone: string, stopped: boolean, messageSid: string) {
  const normalized = normalizeSmsPhone(phone);
  if (!normalized) throw new SmsConsentInputError("Invalid sender phone number.");
  // Retries of the same signed webhook cannot change the event ordering.
  await db.insert(events).values({
    phone: normalized, eventType: stopped ? "carrier_stop" : "carrier_start",
    source: "twilio", providerMessageSid: messageSid,
  }).onConflictDoNothing({ target: events.providerMessageSid });
}
