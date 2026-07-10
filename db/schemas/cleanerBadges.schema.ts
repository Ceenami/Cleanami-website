import { pgTable, uuid, timestamp, jsonb, unique } from "drizzle-orm/pg-core";
import { cleaners } from "./cleaners.schema";
import { badges } from "./badges.schema";

export const cleanerBadges = pgTable('cleaner_badges', {
  id: uuid('id').primaryKey().defaultRandom(),
  cleanerId: uuid('cleaner_id').notNull().references(() => cleaners.id, { onDelete: 'cascade' }),
  badgeId: uuid('badge_id').notNull().references(() => badges.id, { onDelete: 'cascade' }),
  earnedAt: timestamp('earned_at', { withTimezone: true }).defaultNow().notNull(),
  progress: jsonb('progress').$type<Record<string, any>>().default({}),
}, (table) => [
  unique('cleaner_badges_cleaner_badge_unique').on(table.cleanerId, table.badgeId),
]);