import { bigserial, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { cleaners } from "./cleaners.schema";

export const cleanerSmsConsentEvents = pgTable("cleaner_sms_consent_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  cleanerId: uuid("cleaner_id").references(() => cleaners.id, { onDelete: "set null" }),
  phone: text("phone").notNull(),
  eventType: text("event_type").$type<"consent_granted" | "consent_imported" | "consent_withdrawn" | "carrier_stop" | "carrier_start">().notNull(),
  source: text("source").$type<"onboarding" | "profile" | "twilio" | "prior_consent_import">().notNull(),
  evidenceReference: text("evidence_reference"),
  disclosureVersion: text("disclosure_version"),
  disclosureText: text("disclosure_text"),
  termsUrl: text("terms_url"),
  privacyUrl: text("privacy_url"),
  providerMessageSid: text("provider_message_sid"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("cleaner_sms_consent_cleaner_idx").on(table.cleanerId, table.id),
  index("cleaner_sms_consent_phone_idx").on(table.phone, table.id),
  uniqueIndex("cleaner_sms_consent_provider_sid_idx").on(table.providerMessageSid),
]);
