import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * Durable ledger of Stripe event ids we have processed, so the webhook and the
 * money crons can dedupe replays (Stripe may deliver an event more than once).
 */
export const processedStripeEvents = pgTable(
  "processed_stripe_events",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    processedAt: timestamp("processed_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("processed_stripe_events_event_id_key").on(table.eventId),
  ]
);

export const insertProcessedStripeEventSchema =
  createInsertSchema(processedStripeEvents);
export const selectProcessedStripeEventSchema =
  createSelectSchema(processedStripeEvents);

export type ProcessedStripeEvent = z.infer<
  typeof selectProcessedStripeEventSchema
>;
export type NewProcessedStripeEvent = z.infer<
  typeof insertProcessedStripeEventSchema
>;
