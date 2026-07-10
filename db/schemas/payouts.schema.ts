import { pgTable, uuid, timestamp, numeric, text, pgEnum } from 'drizzle-orm/pg-core';
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
  stripePayoutId: text('stripe_payout_id').unique(),
  status: payoutStatusEnum('status').default('pending'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
