import { pgTable, timestamp, uuid, text, boolean, jsonb, numeric, integer, pgEnum, index } from "drizzle-orm/pg-core";
import { jobs } from "./jobs.schema";

// Enum for evidence packet status
export const evidencePacketStatusEnum = pgEnum('evidence_packet_status', ['complete', 'incomplete', 'pending_review']);

export const evidencePackets = pgTable('evidence_packets', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }).unique().notNull(),
  photoUrls: text('photo_urls').array(),
  isChecklistComplete: boolean('is_checklist_complete').default(false),
  checklistLog: jsonb('checklist_log'), // Can store a log of items checked
  gpsCheckInTimestamp: timestamp('gps_check_in_timestamp', { withTimezone: true }),
  gpsCheckOutTimestamp: timestamp('gps_check_out_timestamp', { withTimezone: true }),
  // GPS accountability (captured from the cleaner's device at check-in/out).
  checkInLatitude: numeric('check_in_latitude', { precision: 10, scale: 8 }),
  checkInLongitude: numeric('check_in_longitude', { precision: 11, scale: 8 }),
  checkInAccuracyMeters: numeric('check_in_accuracy_meters', { precision: 8, scale: 2 }),
  checkInDistanceMiles: numeric('check_in_distance_miles', { precision: 8, scale: 3 }),
  checkInWithinGeofence: boolean('check_in_within_geofence'),
  checkOutLatitude: numeric('check_out_latitude', { precision: 10, scale: 8 }),
  checkOutLongitude: numeric('check_out_longitude', { precision: 11, scale: 8 }),
  checkOutAccuracyMeters: numeric('check_out_accuracy_meters', { precision: 8, scale: 2 }),
  checkOutDistanceMiles: numeric('check_out_distance_miles', { precision: 8, scale: 3 }),
  checkOutWithinGeofence: boolean('check_out_within_geofence'),
  // On-time accountability vs the scheduled arrival window.
  arrivalDelayMinutes: integer('arrival_delay_minutes'),
  arrivalOnTime: boolean('arrival_on_time'),
  cleanerNotes: text('cleaner_notes'),
  status: evidencePacketStatusEnum('status').default('pending_review'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  // Index for payout blocker queries
  statusIdx: index("evidence_packets_status_idx").on(table.status),
}));
