import {
  pgTable,
  uuid,
  timestamp,
  text,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { cleaners } from "./cleaners.schema";

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
  ]
);
