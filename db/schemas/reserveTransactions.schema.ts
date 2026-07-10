import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";
import { jobs } from "./jobs.schema";

export const reserveTransactions = pgTable('reserve_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'cascade' }).notNull(),
  paymentIntentId: text('payment_intent_id').notNull(),
  totalAmountCents: integer('total_amount_cents').notNull(),
  reserveAmountCents: integer('reserve_amount_cents').notNull(), // 2%
  netAmountCents: integer('net_amount_cents').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});