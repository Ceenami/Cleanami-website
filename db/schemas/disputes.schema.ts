import {
  pgTable,
  uuid,
  timestamp,
  text,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { cleaners } from "./cleaners.schema";
import { jobs } from "./jobs.schema";

export const disputeTypeEnum = pgEnum("dispute_type", [
  "pay",
  "reliability_score",
  "job_assignment",
]);

export const disputeStatusEnum = pgEnum("dispute_status", [
  "pending",
  "resolved",
  "denied",
]);

export const disputes = pgTable(
  "disputes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cleanerId: uuid("cleaner_id")
      .notNull()
      .references(() => cleaners.id, { onDelete: "cascade" }),
    type: disputeTypeEnum("type").notNull(),
    description: text("description").notNull(),
    status: disputeStatusEnum("status").default("pending").notNull(),
    /**
     * The job this dispute is about, when the cleaner named one. Nullable by
     * design — a reliability-score dispute often has no single job. Set null on
     * job deletion so purging a job never destroys the dispute.
     */
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("disputes_cleaner_idx").on(table.cleanerId),
    index("disputes_status_idx").on(table.status),
    index("disputes_job_idx").on(table.jobId),
  ]
);
