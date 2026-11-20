import { pgTable, text, uuid, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { jobs } from "./jobs.schema";
import { subscriptions } from "./subscriptions.schema";
import { cleaners } from "./cleaners.schema";

// 0061: private transactional notification intents; no message/access-code payloads.
export const notificationEvents = pgTable("phase3a_notification_events", {
  identity: text("identity").primaryKey(), kind: text("kind").notNull(),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
  subscriptionId: uuid("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),
  cleanerId: uuid("cleaner_id").references(() => cleaners.id, { onDelete: "set null" }),
  state: text("state").notNull().default("pending"),
  recipient: text("recipient"), outcome: jsonb("outcome"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
}, t => [index("phase3a_notification_pending").on(t.state, t.createdAt)]);

export const messageStatus = pgTable("phase3a_message_status", {
  messageSid: text("message_sid").primaryKey(), status: text("status").notNull(),
  rank: text("rank").notNull(), errorCode: text("error_code"),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
});
