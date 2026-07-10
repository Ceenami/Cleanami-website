import { pgTable, uuid, timestamp, text, integer, jsonb, pgEnum } from "drizzle-orm/pg-core";

export const badgeCategoryEnum = pgEnum('badge_category', ['reliability', 'performance', 'specialization', 'achievement']);

export const badges = pgTable('badges', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  description: text('description').notNull(),
  icon: text('icon').notNull(),
  category: badgeCategoryEnum('category').notNull(),
  requirements: jsonb('requirements').$type<Record<string, any>>().notNull(),
  pointsValue: integer('points_value').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});