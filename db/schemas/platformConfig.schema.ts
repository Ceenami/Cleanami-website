import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

/**
 * Small admin-editable key→int config store (task 1.9). Kept distinct from the
 * dashboard-managed `app_settings` table. Currently holds
 * `first_clean_discount_percent`.
 */
export const platformConfig = pgTable("platform_config", {
  key: text("key").primaryKey(),
  intValue: integer("int_value"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
