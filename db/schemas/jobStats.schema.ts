import { pgTable, uuid, timestamp, integer, boolean, unique } from "drizzle-orm/pg-core";
import { cleaners } from "./cleaners.schema";
import { jobs } from "./jobs.schema";

export const jobStats = pgTable('job_stats', {
  id: uuid('id').primaryKey().defaultRandom(),
  cleanerId: uuid('cleaner_id').notNull().references(() => cleaners.id, { onDelete: 'cascade' }),
  jobId: uuid('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  rating: integer('rating'), // 1-5 stars
  hasHotTub: boolean('has_hot_tub').default(false).notNull(),
  isTeamLeader: boolean('is_team_leader').default(false).notNull(),
  isLaundryLead: boolean('is_laundry_lead').default(false).notNull(),
  isOnCall: boolean('is_on_call').default(false).notNull(),
  bonusEarnedCents: integer('bonus_earned_cents').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('job_stats_cleaner_job_unique').on(table.cleanerId, table.jobId),
]);