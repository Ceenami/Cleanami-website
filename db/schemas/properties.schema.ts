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
    /**
     * 0035 — varchar + CHECK rather than a pgEnum, because a value added by
     * ALTER TYPE cannot be used until its transaction commits. The two literals
     * are the client's own, from the 2026-08-27 counterproposal; the display
     * labels ("Vacation Rental Turnover", "One-Time Residential Clean") live in
     * the application.
     */
    serviceType: varchar("service_type", {
      enum: ["vacation_rental_subscription", "residential_one_time"],
    })
      .default("vacation_rental_subscription")
      .notNull(),
    /** 0035 — drives the $10/clean pet fee and the cleaner's pet note. Both service types. */
    petsAllowed: boolean("pets_allowed").default(false).notNull(),
    /**
     * 0035 — how the cleaner gets in. NULL means "not recorded", which is every
     * property predating the migration; it is deliberately not defaulted,
     * because inventing an entry method is a lie a cleaner acts on at 9am.
     */
    entryMethod: varchar("entry_method", {
      enum: [
        "smart_lock", "lockbox", "hidden_key", "customer_present",
        "front_desk", "garage_code", "gate_code", "other",
      ],
    }),
    /**
     * 0035 — CREDENTIAL STORE. Holds door, lockbox, gate and garage codes.
     * Never put this in an email, an SMS, a push payload, a `notifications`
     * row, `jobs.notes`, `jobs.addons_snapshot` or Stripe metadata. Return it
     * only to an admin or to the ASSIGNED cleaner.
     */
    entryInstructions: text("entry_instructions"),
    /** 0035 — free text, both service types. Not a credential, unlike entryInstructions. */
    parkingInstructions: text("parking_instructions"),
    /**
     * 0035 — the customer's own notes about the clean (item 4's "Special
     * notes"). **Not a credential**: "the dog is friendly but barks" is not a
     * door code, so unlike `entryInstructions` this may be shown beside the
     * access details rather than locked behind them — but it is still customer
     * content and stays off emails and snapshots by default.
     *
     * It is also where a "the house is in rough shape" signal lands now that
     * the Heavy-condition question was dropped.
     */
    specialInstructions: text("special_instructions"),
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
