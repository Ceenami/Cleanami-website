import { pgTable, text, uuid, boolean, timestamp, index, primaryKey } from "drizzle-orm/pg-core";

// SQL0068 is the authority for private grants, immutable intent identities and
// append-only carrier observations. No relationship to a cleaner account.
export const adminSmsIntents = pgTable("admin_sms_intents", {
  identity: text("identity").primaryKey(), recipient: text("recipient").notNull(),
  senderKey: text("sender_key").notNull(), category: text("category").notNull(),
  environment: text("environment").notNull(),
  jobId: uuid("job_id"), destination: text("destination").notNull(),
  state: text("state").notNull().default("pending"), providerSid: text("provider_sid").unique(),
  lastError: text("last_error"), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
}, t => [index("admin_sms_pending").on(t.state, t.createdAt), index("admin_sms_job").on(t.jobId)]);
export const adminSmsPreferences = pgTable("admin_sms_preferences", {
  recipient: text("recipient").notNull(), senderKey: text("sender_key").notNull(),
  carrierBlocked: boolean("carrier_blocked").notNull().default(false),
  lastStopSid: text("last_stop_sid"), lastStopAt: timestamp("last_stop_at", { withTimezone: true }),
  lastStartAt: timestamp("last_start_at", { withTimezone: true }),
  optedInAt: timestamp("opted_in_at", { withTimezone: true }),
}, t => [primaryKey({ columns: [t.recipient, t.senderKey] })]);
export const adminSmsCarrierEvents = pgTable("admin_sms_carrier_events", {
  messageSid: text("message_sid").primaryKey(), recipient: text("recipient").notNull(),
  senderKey: text("sender_key").notNull(), blocked: boolean("blocked").notNull(),
  providerCreatedAt: timestamp("provider_created_at", { withTimezone: true }),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [index("admin_sms_carrier_phone").on(t.recipient, t.senderKey)]);
