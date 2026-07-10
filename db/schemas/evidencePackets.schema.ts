import { pgTable, timestamp, uuid, text, boolean, jsonb, pgEnum, index } from "drizzle-orm/pg-core";
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
  cleanerNotes: text('cleaner_notes'),
  status: evidencePacketStatusEnum('status').default('pending_review'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  // Index for payout blocker queries
  statusIdx: index("evidence_packets_status_idx").on(table.status),
}));
