import { pgTable, uuid, timestamp, text, pgEnum, boolean, uniqueIndex, primaryKey, index, numeric, jsonb, varchar } from "drizzle-orm/pg-core";
import { subscriptions } from "./subscriptions.schema";
import { properties } from "./properties.schema";
import { cleaners } from "./cleaners.schema";
import { promoCodes } from "./promoCodes.schema";
import type { ChecklistSnapshot } from "@/lib/cleaner/checklist-snapshot";

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
    inUnitLaundryHours?: number;
    offSiteLaundryHours?: number;
    hotTubHours?: number;
    /** 0035 — drives the $10/clean pet fee and the cleaner's pet note. */
    petsAllowed?: boolean;
    /**
     * 0035 — the arrival-window KEY, e.g. "9-11am". Display fidelity only: the
     * job's real bounds are check_in_time (window start) and check_out_time
     * (must-finish-before = window end PLUS expected hours, never the window
     * end alone).
     */
    arrivalWindow?: string | null;
  }>(),
  /** 0040: the exact checklist and documents issued with this job. */
  checklistSnapshot: jsonb('checklist_snapshot').$type<ChecklistSnapshot | null>(),
  
  paymentIntentId: text('payment_intent_id'),
  paymentStatus: paymentStatusEnum('payment_status'), // Use the enum defined above
  paymentFailed: boolean('payment_failed').default(false),
  /**
   * A customer-applied promo code for THIS job's still-unauthorized recurring
   * charge (task: customer-entered promo codes on upcoming cleans). Never
   * cleared after redemption — it's an audit trail, and the cron's own
   * `payment_intent_id IS NULL` filter already prevents reprocessing.
   */
  promoCodeId: uuid('promo_code_id').references(() => promoCodes.id, { onDelete: 'set null' }),
  notes: text('notes'),
  /**
   * 0035 — varchar + CHECK, not a pgEnum: a value added by ALTER TYPE cannot be
   * used until its transaction commits, which breaks add-then-backfill. Frozen
   * at creation and never followed back to the property, in the same spirit as
   * addonsSnapshot. Denormalised off `properties` so the same-day conflict rule
   * and the admin filters need no join.
   */
  serviceType: varchar('service_type', {
    enum: ['vacation_rental_subscription', 'residential_one_time'],
  }).default('vacation_rental_subscription').notNull(),
  /** 0035 — where the job came from, which is a different question from what kind of service it is. */
  jobSource: varchar('job_source', {
    enum: ['ical', 'manual', 'customer_one_off', 'public_residential_booking'],
  }).default('ical').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
   uniqueIndex("calendar_event_uid_idx").on(table.calendarEventUid),
   index("jobs_status_idx").on(table.status),
   index("jobs_service_type_idx").on(table.serviceType),
]);

export const jobsToCleaners = pgTable('jobs_to_cleaners', {
  jobId: uuid('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  cleanerId: uuid('cleaner_id').notNull().references(() => cleaners.id, { onDelete: 'cascade' }),
  role: jobCleanerRoleEnum('role').notNull(),
  urgentBonus: boolean('urgent_bonus').default(false),
  isTeamLeader: boolean('is_team_leader').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  // A cleaner can only have one role per job
  pk: primaryKey({ columns: [table.jobId, table.cleanerId,] }),
}));
