import {
  date,
  index,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { cleaners } from "./cleaners.schema";

/** How the cleaner supplied the current two-week availability block. */
export const availabilitySubmissionModeEnum = pgEnum(
  "availability_submission_mode",
  ["full", "override"]
);

/**
 * One durable acknowledgement per cleaner and planning period.
 *
 * Daily `availability` rows deliberately contain only dates a cleaner marked
 * available. This table preserves the otherwise-lost distinction between
 * "I submitted no available dates" and "I did not submit at all", without
 * turning routine availability edits into an unbounded audit log.
 */
export const cleanerAvailabilitySubmissions = pgTable(
  "cleaner_availability_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cleanerId: uuid("cleaner_id")
      .references(() => cleaners.id, { onDelete: "cascade" })
      .notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    submissionMode: availabilitySubmissionModeEnum("submission_mode")
      .default("full")
      .notNull(),
    firstSubmittedAt: timestamp("first_submitted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("cleaner_availability_submissions_period_unique").on(
      table.cleanerId,
      table.periodStart
    ),
    index("cleaner_availability_submissions_period_idx").on(
      table.periodStart,
      table.periodEnd
    ),
  ]
);
