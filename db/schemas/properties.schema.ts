import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  varchar,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { customers } from "./customers.schema";

export const properties = pgTable(
  "properties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    address: text("address").notNull(),
    sqFt: integer("sq_ft"),
    bedCount: integer("bed_count").notNull(),
    bathCount: numeric("bath_count", { precision: 3, scale: 1 }).notNull(),
    hasHotTub: boolean("has_hot_tub").default(false).notNull(),
    laundryType: varchar("laundry_type", {
      enum: ["in_unit", "off_site", "none"],
    }).notNull(),
    laundryLoads: integer("laundry_loads"),
    hotTubServiceLevel: boolean("hot_tub_service").default(false).notNull(),
    hotTubDrain: boolean("needs_drain").default(false).notNull(),
    hotTubDrainCadence: varchar("hot_tub_drain_cadence", {
      enum: ["4_weeks", "6_weeks", "2_months", "3_months", "4_months"],
    }),
    useDefaultChecklist: boolean("use_default_check_lict").default(false).notNull(),
    latitude: numeric("latitude", { precision: 10, scale: 8 }),
    longitude: numeric("longitude", { precision: 11, scale: 8 }),
    geocodedAt: timestamp("geocoded_at"),
    /**
     * Check-in geofence radius in metres (50-1000), or null to use the system
     * default. Raised for properties with a large lot, where the door can sit
     * legitimately far from the geocoded street pin. See
     * lib/services/gps/geofence.ts — the DB holds metres, the GPS code works
     * in miles, and the conversion happens in exactly one place.
     */
    geofenceRadiusMeters: integer("geofence_radius_meters"),
    iCalUrl: text('ical_url'),
    /** Admin per-property price override in cents; null = use calculated price. */
    priceOverrideCents: integer('price_override_cents'),
    defaultCheckInTime: text('default_check_in_time').default('16:00:00'),
    defaultCheckOutTime: text('default_check_out_time').default('09:00:00'),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("properties_customer_idx").on(table.customerId),
    index("properties_location_idx").on(table.latitude, table.longitude),
  ]
);

export const insertPropertySchema = createInsertSchema(properties);
export const selectPropertySchema = createSelectSchema(properties);

export type Property = z.infer<typeof selectPropertySchema>;
export type NewProperty = z.infer<typeof insertPropertySchema>;
