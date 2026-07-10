import { pgTable, uuid, timestamp, integer, boolean, pgEnum } from "drizzle-orm/pg-core";
import { jobs } from "./jobs.schema";
import { cleaners } from "./cleaners.schema";

export const expectedLatenessEnum = pgEnum('expected_lateness', ['on_time', 'under_10', 'under_30', 'hour_plus']);

export const reliabilityChecks = pgTable('reliability_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  cleanerId: uuid('cleaner_id').notNull().references(() => cleaners.id, { onDelete: 'cascade' }),
  notificationSentAt: timestamp('notification_sent_at', { withTimezone: true }).defaultNow().notNull(),
  responseReceivedAt: timestamp('response_received_at', { withTimezone: true }),
  expectedLateness: expectedLatenessEnum('expected_lateness'),
  actualArrivalDelayMinutes: integer('actual_arrival_delay_minutes'),
  manualCheckinAt: timestamp('manual_checkin_at', { withTimezone: true }),
  gpsArrivalAt: timestamp('gps_arrival_at', { withTimezone: true }),
  manualCheckoutAt: timestamp('manual_checkout_at', { withTimezone: true }),
  gpsDepartureAt: timestamp('gps_departure_at', { withTimezone: true }),
  jobCancelled: boolean('job_cancelled').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});