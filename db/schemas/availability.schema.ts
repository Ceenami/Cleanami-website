import { pgTable, uuid, time, timestamp, date, boolean, pgEnum, index } from 'drizzle-orm/pg-core';
import { cleaners } from './cleaners.schema';

export const availabilityTypeEnum = pgEnum('availability_type', ['vacation_rental', 'residential']);

export const availabilitySubmissionStatusEnum = pgEnum('availability_submission_status', [
  'on_time',
  'late_accepted',
  'late_warning',
]);

export const availability = pgTable('availability', {
  id: uuid('id').primaryKey().defaultRandom(),
  cleanerId: uuid('cleaner_id').references(() => cleaners.id, { onDelete: 'cascade' }).notNull(),
  date: date('date').notNull(),
  availabilityType: availabilityTypeEnum('availability_type').notNull(),
  startTime: time('start_time').notNull(),
  endTime: time('end_time').notNull(),
  onCallEligible: boolean('on_call_eligible').default(false),
  openPoolEligible: boolean('open_pool_eligible').default(false),
  isGracePeriod: boolean('is_grace_period').default(false),
  submissionStatus: availabilitySubmissionStatusEnum('submission_status')
    .default('on_time')
    .notNull(),
  submittedAt: timestamp('submitted_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  availabilityDateIdx: index("availability_date_cleaner_idx").on(table.date, table.cleanerId),
}));