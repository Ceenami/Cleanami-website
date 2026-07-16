import {
  pgTable,
  uuid,
  integer,
  timestamp,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { properties } from "./properties.schema";
import { cleaners } from "./cleaners.schema";

/**
 * Per-property cleaner hierarchy. Ordering of preference when the assignment
 * engine picks who cleans a property:
 *   main_primary > secondary_primary > preferred_backup > on_call
 */
export const propertyCleanerTierEnum = pgEnum("property_cleaner_tier", [
  "main_primary",
  "secondary_primary",
  "preferred_backup",
  "on_call",
]);

export const propertyCleaners = pgTable(
  "property_cleaners",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    cleanerId: uuid("cleaner_id")
      .notNull()
      .references(() => cleaners.id, { onDelete: "cascade" }),
    tier: propertyCleanerTierEnum("tier").notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("property_cleaners_property_cleaner_unique").on(
      table.propertyId,
      table.cleanerId
    ),
    index("property_cleaners_property_idx").on(table.propertyId),
    index("property_cleaners_cleaner_idx").on(table.cleanerId),
  ]
);

export const insertPropertyCleanerSchema = createInsertSchema(propertyCleaners);
export const selectPropertyCleanerSchema = createSelectSchema(propertyCleaners);

export type PropertyCleaner = z.infer<typeof selectPropertyCleanerSchema>;
export type NewPropertyCleaner = z.infer<typeof insertPropertyCleanerSchema>;
export type PropertyCleanerTier =
  (typeof propertyCleanerTierEnum.enumValues)[number];
