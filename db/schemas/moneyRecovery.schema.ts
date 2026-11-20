import { pgTable, uuid, text, integer, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type Stripe from "stripe";
import type { PriceDetails } from "@/lib/validations/bookng-modal";

export type RentalCheckoutTerms = {
  version: 1;
  form: Record<string, unknown>;
  price: PriceDetails;
  minimumPolicy?: string;
  termPolicy?: string;
  financePolicy?: string;
  promoDiscountCents: number;
};

export const rentalCheckoutAttempts = pgTable("rental_checkout_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  slotKey: text("slot_key").notNull(),
  generation: integer("generation").notNull(),
  requestIdentity: text("request_identity").notNull(),
  terms: jsonb("terms").$type<RentalCheckoutTerms>().notNull(),
  providerParams: jsonb("provider_params").$type<Stripe.PaymentIntentCreateParams>().notNull(),
  paymentIntentId: text("payment_intent_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [uniqueIndex("rental_checkout_slot_generation").on(t.slotKey, t.generation),
  uniqueIndex("rental_checkout_payment_intent").on(t.paymentIntentId)]);

export const payoutTransferAttempts = pgTable("payout_transfer_attempts", {
  payoutId: uuid("payout_id").primaryKey(),
  providerParams: jsonb("provider_params").$type<Stripe.TransferCreateParams>().notNull(),
  state: text("state").notNull().default("prepared"),
  transferId: text("transfer_id").unique(),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const stripeWebhookClaims = pgTable("stripe_webhook_claims", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  payloadHash: text("payload_hash").notNull(),
  state: text("state").notNull(),
  token: uuid("token").notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});
