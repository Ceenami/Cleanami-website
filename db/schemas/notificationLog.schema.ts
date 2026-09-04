import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { jobs } from "./jobs.schema";
import { users } from "./users.schema";

export const NOTIFICATION_CHANNELS = ["email", "sms", "push", "in_app"] as const;

export const NOTIFICATION_SEND_STATUSES = ["sent", "failed", "skipped"] as const;

/**
 * One row per notification ATTEMPT (migration 0039).
 *
 * Written inside the channel services themselves — not at the call sites —
 * because a call site can be added without a log and nothing would notice. The
 * whole value of this table is that it cannot be lied to.
 *
 * It records that a message was handed to a provider, rejected, or never
 * attempted. It does NOT record delivery: handing a message to Resend is not
 * the same as a human receiving it.
 *
 * `skipped` is the load-bearing status. Every channel degrades gracefully when
 * its provider key is unset, which is correct behaviour and is also why
 * "unconfigured" and "never triggered" are indistinguishable without this
 * table. A `skipped` row with a reason tells them apart.
 *
 * Never store a message body here, and never anything derived from
 * `properties.entryInstructions` — that column holds door, lockbox, gate and
 * garage codes, and this is a new surface that could quietly leak them.
 */
export const notificationLog = pgTable(
  "notification_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channel: varchar("channel", { enum: NOTIFICATION_CHANNELS }).notNull(),
    /**
     * The event that caused the send, e.g. `residential_booking_confirmation`.
     * Counting this column is how "which notifications actually send?" is
     * answered.
     */
    trigger: text("trigger").notNull(),
    /** Address, phone number or user id. The most this table may know about a person. */
    recipient: text("recipient"),
    /** Nullable: an email can precede an account existing. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /** Set null on job deletion, so purging a job orphans its send history rather than erasing it. */
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    status: varchar("status", { enum: NOTIFICATION_SEND_STATUSES }).notNull(),
    /** The provider's message when `failed`, or why nothing was attempted when `skipped`. */
    error: text("error"),
    /**
     * Resend or Twilio message id. Added now and left null for this phase: it
     * costs nothing at table-creation time and is the one thing a future
     * delivery-confirmation webhook would match on.
     */
    providerMessageId: text("provider_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("notification_log_trigger_created_idx").on(
      table.trigger,
      table.createdAt.desc()
    ),
  ]
);
