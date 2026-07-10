import { pgTable, uuid, timestamp, boolean, text, index } from "drizzle-orm/pg-core";
import { cleaners } from "./cleaners.schema";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import z from "zod";

export const userPreferences = pgTable('user_preferences', {
  id: uuid('id').primaryKey().defaultRandom(),
  cleanerId: uuid('cleaner_id').notNull().references(() => cleaners.id, { onDelete: 'cascade' }).unique(),
  
  // Notification preferences
  pushNotificationsEnabled: boolean('push_notifications_enabled').notNull().default(true),
  onCallAlertsEnabled: boolean('on_call_alerts_enabled').notNull().default(false),
  emailNotificationsEnabled: boolean('email_notifications_enabled').notNull().default(true),
  smsNotificationsEnabled: boolean('sms_notifications_enabled').notNull().default(false),
  
  // Privacy & Location preferences
  locationTrackingEnabled: boolean('location_tracking_enabled').notNull().default(true),
  autoPhotoUploadEnabled: boolean('auto_photo_upload_enabled').notNull().default(false),
  shareLocationWithTeam: boolean('share_location_with_team').notNull().default(false),
  
  // App preferences
  preferredLanguage: text('preferred_language').notNull().default('en'),
  preferredRegion: text('preferred_region').notNull().default('US'),
  theme: text('theme').notNull().default('system'),
  
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('idx_user_preferences_cleaner_id').on(t.cleanerId),
]);

export const insertUserPreferencesSchema = createInsertSchema(userPreferences);
export const selectUserPreferencesSchema = createSelectSchema(userPreferences);
export const updateUserPreferencesSchema = insertUserPreferencesSchema.partial().omit({ 
  id: true,
  createdAt: true,
});

export type UserPreferences = z.infer<typeof selectUserPreferencesSchema>;
export type NewUserPreferences = z.infer<typeof insertUserPreferencesSchema>;
export type UpdateUserPreferences = z.infer<typeof updateUserPreferencesSchema>;