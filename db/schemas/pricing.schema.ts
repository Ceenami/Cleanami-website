import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  integer,
  boolean,
  decimal,
} from "drizzle-orm/pg-core";
import { users } from "./users.schema"; 

export const pricingUploads = pgTable("pricing_uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  fileUrl: text("file_url").notNull(),
  status: varchar("status", { enum: ["processing", "success", "failed"] })
    .default("processing")
    .notNull(),
  notes: text("notes"),
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const basePricingRules = pgTable("base_pricing_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  bedrooms: integer("bedrooms").notNull().unique(),
  price1BathCents: integer("price_1_bath_cents").notNull(),
  price2BathCents: integer("price_2_bath_cents").notNull(),
  price3BathCents: integer("price_3_bath_cents").notNull(),
  price4BathCents: integer("price_4_bath_cents").notNull(),
  price5BathCents: integer("price_5_bath_cents").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const sqftSurchargeRules = pgTable("sqft_surcharge_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  rangeStart: integer("range_start").notNull(),
  rangeEnd: integer("range_end").notNull(),
  surchargeCents: integer("surcharge_cents").notNull(),
  isCustomQuote: boolean("is_custom_quote").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const laundryPricingRules = pgTable("laundry_pricing_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  serviceType: varchar("service_type", { enum: ["In-Unit", "Off-Site"] })
    .notNull()
    .unique(),
  customerRevenueBaseCents: integer("customer_revenue_base_cents").notNull(),
  customerRevenuePerLoadCents: integer("customer_revenue_per_load_cents").notNull(),
  cleanerBonusPerLoadCents: integer("cleaner_bonus_per_load_cents").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const hotTubPricingRules = pgTable("hot_tub_pricing_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  serviceType: varchar("service_type", { enum: ["Basic", "Full_Drain"] })
    .notNull()
    .unique(),
  customerRevenueCents: integer("customer_revenue_cents").notNull(),
  timeAddHours: decimal("time_add_hours", { precision: 4, scale: 3 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});