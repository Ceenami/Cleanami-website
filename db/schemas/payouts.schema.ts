import { pgTable, uuid, timestamp, numeric, text, pgEnum, uniqueIndex } from 'drizzle-orm/pg-core';
import { jobs } from './jobs.schema';
import { cleaners } from './cleaners.schema';

// Enum for payout status
export const payoutStatusEnum = pgEnum('payout_status', ['pending', 'released', 'held']);

export const payouts = pgTable('payouts', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'cascade' }).notNull(),
  cleanerId: uuid('cleaner_id').references(() => cleaners.id, { onDelete: 'cascade' }).notNull(),
  amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
  urgentBonusAmount: numeric('urgent_bonus_amount', { precision: 10, scale: 2 }),
  laundryBonusAmount: numeric('laundry_bonus_amount', { precision: 10, scale: 2 }),
  /** Late-arrival pay deduction applied to this payout (already reflected in `amount`). */
  lateDeductionAmount: numeric('late_deduction_amount', { precision: 10, scale: 2 }),
  stripePayoutId: text('stripe_payout_id').unique(),
  status: payoutStatusEnum('status').default('pending'),
  /** Claimed by the payout cron immediately before the Stripe transfer (2.2 row-claim lock). */
  processingStartedAt: timestamp('processing_started_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  // One payout per (job, cleaner) — prevents duplicate payouts (2.2 / PAY-3).
  uniqueIndex('payouts_job_cleaner_key').on(table.jobId, table.cleanerId),
]);
