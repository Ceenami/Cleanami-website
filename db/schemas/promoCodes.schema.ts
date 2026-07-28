import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { customers } from "./customers.schema";
import { subscriptions } from "./subscriptions.schema";

/**
 * Admin-created discount codes redeemed by the customer at booking checkout
 * (task 1.8, migration 0022).
 *
 * A code discounts the PREPAID FIRST CLEAN ONLY — it is applied after the
 * subscription-term discount and after the global first-clean discount, and
 * never reaches the recurring pre-authorize path.
 */
export const promoCodes = pgTable("promo_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Stored upper-cased and trimmed; look up with `normalizePromoCode()`. */
  code: text("code").notNull().unique(),
  description: text("description"),
  discountType: text("discount_type", { enum: ["percent", "fixed"] }).notNull(),
  /** Whole percent (1–100) for `percent`; CENTS for `fixed`. */
  discountValue: integer("discount_value").notNull(),
  active: boolean("active").default(true).notNull(),
  /** `null` = unlimited. */
  maxRedemptions: integer("max_redemptions"),
  /** Counts completed bookings only — an abandoned checkout never burns one. */
  redemptionCount: integer("redemption_count").default(0).notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** One row per code used on a completed booking. */
export const promoRedemptions = pgTable(
  "promo_redemptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    promoCodeId: uuid("promo_code_id")
      .notNull()
      .references(() => promoCodes.id, { onDelete: "cascade" }),
    /** Snapshot of the code text; the promo row may later be renamed/deleted. */
    code: text("code").notNull(),
    customerEmail: text("customer_email").notNull(),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, {
      onDelete: "set null",
    }),
    /**
     * The recurring clean this redemption discounted (null for a first-clean
     * / booking-checkout redemption). Plain column, not a Drizzle
     * `.references()`, to avoid a circular import with jobs.schema.ts (which
     * already references `promoCodes`); the FK constraint itself lives in
     * migration 0027.
     */
    jobId: uuid("job_id"),
    /** UNIQUE — replaying onboarding for the same PI cannot double-count. */
    paymentIntentId: text("payment_intent_id").notNull().unique(),
    originalAmountCents: integer("original_amount_cents").notNull(),
    discountAmountCents: integer("discount_amount_cents").notNull(),
    finalAmountCents: integer("final_amount_cents").notNull(),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("promo_redemptions_code_idx").on(table.promoCodeId),
  ]
);

export const insertPromoCodeSchema = createInsertSchema(promoCodes);
export const selectPromoCodeSchema = createSelectSchema(promoCodes);
export const selectPromoRedemptionSchema =
  createSelectSchema(promoRedemptions);

export type PromoCode = z.infer<typeof selectPromoCodeSchema>;
export type NewPromoCode = z.infer<typeof insertPromoCodeSchema>;
export type PromoRedemption = z.infer<typeof selectPromoRedemptionSchema>;
