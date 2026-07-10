import { pgTable, uuid, timestamp, text, boolean, jsonb, pgEnum, index } from "drizzle-orm/pg-core";
import { users } from "./users.schema";
import { jobs } from "./jobs.schema";

export const notificationTypeEnum = pgEnum('notification_type', [
  'job_reminder', 
  'photo_reminder', 
  'completion_reminder', 
  'urgent_job', 
  'payment_ready',
  'reliability_check',
  'swap_available'
]);

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: notificationTypeEnum('type').notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
  isRead: boolean('is_read').default(false).notNull(),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  metadata: jsonb('metadata').$type<Record<string, any>>().default({}),
}, (table) => [
  index('notifications_user_scheduled_idx').on(table.userId, table.scheduledFor),
  index('notifications_type_job_idx').on(table.type, table.jobId),
]);