import { pgTable, uuid, timestamp, text, index } from "drizzle-orm/pg-core";
import { cleaners } from "./cleaners.schema"; 

export const pushNotificationTokens = pgTable("push_notification_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  cleanerId: uuid("cleaner_id")
    .notNull()
    .references(() => cleaners.id, { onDelete: 'cascade' }),
  token: text("token").notNull().unique(),
  deviceType: text("device_type"),
  
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  cleanerIdx: index("push_tokens_cleaner_idx").on(table.cleanerId),
}));