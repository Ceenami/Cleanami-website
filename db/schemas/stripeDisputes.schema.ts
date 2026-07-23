import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { jobs } from "./jobs.schema";

/**
 * Stripe chargebacks/disputes (from charge.dispute.* webhooks). Kept distinct
 * from the cleaner-facing `disputes` table. Feeds the reserve-rate calculation
 * (spec §5/§20: escalate the platform reserve 2%→5% when the rolling 30-day
 * dispute rate exceeds 0.5%).
 */
export const stripeDisputes = pgTable(
  "stripe_disputes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stripeDisputeId: text("stripe_dispute_id").notNull().unique(),
    paymentIntentId: text("payment_intent_id"),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    amountCents: integer("amount_cents"),
    reason: text("reason"),
    status: text("status"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("stripe_disputes_created_idx").on(table.createdAt)]
);
