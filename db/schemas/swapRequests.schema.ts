import { pgTable, uuid, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { jobs } from "./jobs.schema";
import { cleaners } from "./cleaners.schema";

export const swapRequestStatusEnum = pgEnum('swap_request_status', ['pending', 'accepted', 'expired', 'cancelled', 'urgent']);

export const swapRequests = pgTable('swap_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  originalCleanerId: uuid('original_cleaner_id').notNull().references(() => cleaners.id, { onDelete: 'cascade' }),
  replacementCleanerId: uuid('replacement_cleaner_id').references(() => cleaners.id, { onDelete: 'set null' }),
  requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
  status: swapRequestStatusEnum('status').default('pending').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('swap_requests_job_idx').on(table.jobId),
  index('swap_requests_original_cleaner_idx').on(table.originalCleanerId),
  index('swap_requests_status_idx').on(table.status),
]);