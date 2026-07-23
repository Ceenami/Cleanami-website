import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";
import { jobs } from "./jobs.schema";

export const reserveTransactions = pgTable('reserve_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  // A job is captured once, so it has exactly one reserve entry. The unique
  // constraint is what makes the insert safe to retry: a crash between the
  // Stripe capture and the job status update used to let a re-run add a second
  // row, double-counting the 2% reserve in the ledger.
  jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'cascade' }).notNull().unique(),
  paymentIntentId: text('payment_intent_id').notNull(),
  totalAmountCents: integer('total_amount_cents').notNull(),
  reserveAmountCents: integer('reserve_amount_cents').notNull(), // 2%
  netAmountCents: integer('net_amount_cents').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});