import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";

/** Append-only revisions; original execution contracts stay immutable. */
export const jobScheduleRevisions = pgTable(
  "job_schedule_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Retained when legacy calendar cancellation archives/deletes its job row.
    jobId: uuid("job_id").notNull(),
    source: text("source").$type<"property_defaults" | "manual">().notNull(),
    beforeStart: timestamp("before_start", { withTimezone: true }).notNull(),
    beforeDeadline: timestamp("before_deadline", {
      withTimezone: true,
    }).notNull(),
    plannedStart: timestamp("planned_start", { withTimezone: true }).notNull(),
    plannedDeadline: timestamp("planned_deadline", {
      withTimezone: true,
    }).notNull(),
    actor: text("actor").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("job_schedule_revision_job_idx").on(t.jobId, t.createdAt)],
);

// Store push payloads separately from client-editable notification metadata.
export const jobScheduleNotices = pgTable(
  "job_schedule_notices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => jobScheduleRevisions.id),
    cleanerId: uuid("cleaner_id").notNull(),
    userId: uuid("user_id").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [index("job_schedule_notice_pending_idx").on(t.sentAt, t.createdAt)],
);
