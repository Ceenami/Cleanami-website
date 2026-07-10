import { pgTable, uuid, timestamp, numeric, text, jsonb, pgEnum, index } from "drizzle-orm/pg-core";
import { jobs } from "./jobs.schema";
import { cleaners } from "./cleaners.schema";

export const activityTypeEnum = pgEnum('activity_type', ['arrival', 'working', 'departure']);

export const gpsTrackingLogs = pgTable('gps_tracking_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  cleanerId: uuid('cleaner_id').notNull().references(() => cleaners.id, { onDelete: 'cascade' }),
  latitude: numeric('latitude', { precision: 10, scale: 8 }).notNull(),
  longitude: numeric('longitude', { precision: 11, scale: 8 }).notNull(),
  accuracy: numeric('accuracy', { precision: 8, scale: 2 }),
  activityType: activityTypeEnum('activity_type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  metadata: jsonb('metadata').$type<Record<string, any>>().default({}),
}, (table) => [
  index('gps_tracking_logs_job_cleaner_idx').on(table.jobId, table.cleanerId),
  index('gps_tracking_logs_created_at_idx').on(table.createdAt),
]);