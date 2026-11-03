import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { ResidentialV2Terms } from "@/lib/pricing/residential";
export const residentialCheckoutAttempts = pgTable(
  "phase2c_residential_checkout_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slotKey: text("slot_key").notNull(),
    generation: integer("generation").notNull(),
    requestIdentity: text("request_identity").notNull(),
    terms: jsonb("terms").$type<ResidentialV2Terms>().notNull(),
    amountChargedCents: integer("amount_charged_cents").notNull(),
    paymentIntentId: text("payment_intent_id"),
    jobId: uuid("job_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("residential_checkout_slot_generation").on(
      t.slotKey,
      t.generation,
    ),
    uniqueIndex("residential_checkout_payment_intent").on(t.paymentIntentId),
  ],
);
