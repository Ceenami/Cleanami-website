import { pgTable, uuid, timestamp, text, integer, pgEnum } from "drizzle-orm/pg-core";
import { cleaners } from "./cleaners.schema";
import { jobs } from "./jobs.schema";

export const reliabilityEventTypeEnum = pgEnum('reliability_event_type', [
  'late_arrival', 
  'no_show', 
  'call_out', 
  'on_time', 
  'early_arrival'
]);

export const reliabilityEvents = pgTable('reliability_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  cleanerId: uuid('cleaner_id').notNull().references(() => cleaners.id, { onDelete: 'cascade' }),
  jobId: uuid('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  eventType: reliabilityEventTypeEnum('event_type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  notes: text('notes'),
  penaltyPoints: integer('penalty_points').default(0).notNull(),
});