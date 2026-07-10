import { pgTable, uuid, timestamp, text, pgEnum, boolean, uniqueIndex, primaryKey, index, numeric, jsonb } from "drizzle-orm/pg-core";
import { subscriptions } from "./subscriptions.schema";
import { properties } from "./properties.schema";
import { cleaners } from "./cleaners.schema";

export const jobStatusEnum = pgEnum('job_status', [
  'unassigned',
  'assigned',
  'in-progress',
  'completed_pending_evidence',
  'awaiting_capture',
  'completed',
  'canceled',
]);

export const jobCleanerRoleEnum = pgEnum('job_cleaner_role', ['primary', 'backup', 'on-call', 'laundry_lead']);

export const paymentStatusEnum = pgEnum('payment_status', ['pending', 'authorized', 'captured', 'failed', 'capture_failed']);

export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  subscriptionId: uuid('subscription_id').references(() => subscriptions.id),
  propertyId: uuid('property_id').references(() => properties.id),
  status: jobStatusEnum('status').default('unassigned'),
  checkInTime: timestamp('check_in_time', { withTimezone: true }),
  checkOutTime: timestamp('check_out_time', { withTimezone: true }),
  calendarEventUid: text('calendar_event_uid').notNull(),
  expectedHours: numeric('expected_hours', { precision: 4, scale: 2 }),
  addonsSnapshot: jsonb('addons_snapshot').$type<{
    laundryType: string;
    laundryLoads?: number | null;
    hotTubServiceLevel?: string | null;
    hotTubDrainCadence?: string | null;
    teamSize?: number | null;
    propertySize?: "small" | "medium" | "large" | "custom";
    requiresManualStaffing?: boolean;
    bedroomBathroomTotal?: number;
    baseCleaningHours?: number;
    offSiteLaundryHours?: number;
    hotTubHours?: number;
  }>(),
  
  paymentIntentId: text('payment_intent_id'),
  paymentStatus: paymentStatusEnum('payment_status'), // Use the enum defined above
  paymentFailed: boolean('payment_failed').default(false),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
   uniqueIndex("calendar_event_uid_idx").on(table.calendarEventUid),
   index("jobs_status_idx").on(table.status),
]);

export const jobsToCleaners = pgTable('jobs_to_cleaners', {
  jobId: uuid('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  cleanerId: uuid('cleaner_id').notNull().references(() => cleaners.id, { onDelete: 'cascade' }),
  role: jobCleanerRoleEnum('role').notNull(),
  urgentBonus: boolean('urgent_bonus').default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  // A cleaner can only have one role per job
  pk: primaryKey({ columns: [table.jobId, table.cleanerId,] }),
}));
