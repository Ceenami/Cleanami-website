import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { jobs } from "./jobs.schema";
import { properties } from "./properties.schema";
import { cleaners } from "./cleaners.schema";
import { users } from "./users.schema";

export const RESTOCK_STATUSES = [
  "requested",
  "approved",
  "ordered",
  "fulfilled",
  "declined",
] as const;

export const RESTOCK_URGENCIES = ["low", "normal", "urgent"] as const;

/**
 * Cleaner-raised supply requests (task 1.16, migration 0023).
 *
 * Free by design: a cleaner flags that a property is low on something, an admin
 * works the queue. There is no amount column and nothing here touches a charge
 * — spec §29 treats paid restocking add-ons as future scope.
 */
export const restockRequests = pgTable(
  "restock_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The job the cleaner was on. Kept nullable so purging jobs is non-destructive. */
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    cleanerId: uuid("cleaner_id").references(() => cleaners.id, {
      onDelete: "set null",
    }),
    item: text("item").notNull(),
    quantity: integer("quantity").default(1).notNull(),
    urgency: text("urgency", { enum: RESTOCK_URGENCIES })
      .default("normal")
      .notNull(),
    notes: text("notes"),
    status: text("status", { enum: RESTOCK_STATUSES })
      .default("requested")
      .notNull(),
    adminNotes: text("admin_notes"),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("restock_requests_status_idx").on(table.status),
    index("restock_requests_property_idx").on(table.propertyId),
    index("restock_requests_cleaner_idx").on(table.cleanerId),
  ]
);

export const insertRestockRequestSchema = createInsertSchema(restockRequests);
export const selectRestockRequestSchema = createSelectSchema(restockRequests);

export type RestockRequest = z.infer<typeof selectRestockRequestSchema>;
export type NewRestockRequest = z.infer<typeof insertRestockRequestSchema>;
export type RestockStatus = (typeof RESTOCK_STATUSES)[number];
export type RestockUrgency = (typeof RESTOCK_URGENCIES)[number];
