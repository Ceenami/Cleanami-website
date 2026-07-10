import { pgTable, text, timestamp, jsonb, uuid, boolean, numeric, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { relations } from "drizzle-orm";
import { properties } from "./properties.schema";
import { subscriptions } from "./subscriptions.schema";
import { jobStatusEnum, paymentStatusEnum } from "./jobs.schema";


export const cancelledJobs = pgTable("cancelled_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  originalJobId: uuid("original_job_id").notNull(),
  subscriptionId: uuid("subscription_id").notNull(),
  propertyId: uuid("property_id").notNull(),
  calendarEventUid: text("calendar_event_uid").notNull(),
  checkInTime: timestamp("check_in_time", { withTimezone: true }).notNull(),
  checkOutTime: timestamp("check_out_time", { withTimezone: true }).notNull(),
  status: jobStatusEnum("status").notNull(),
  expectedHours: text("expected_hours"),
  addonsSnapshot: jsonb("addons_snapshot").$type<{
    laundryType: string;
    laundryLoads?: number | null;
    hotTubServiceLevel?: string | null;
    hotTubDrainCadence?: string | null;
  }>(),
  paymentIntentId: text("payment_intent_id"),
  paymentStatus: paymentStatusEnum("payment_status"),
  paymentFailed: boolean("payment_failed"),
  notes: text("notes"),
  originalCreatedAt: timestamp("original_created_at", { withTimezone: true }).notNull(),
  originalUpdatedAt: timestamp("original_updated_at", { withTimezone: true }).notNull(),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }).notNull().defaultNow(),
  cancellationSource: text("cancellation_source").notNull().default("auto_detected"),
  cancellationReason: text("cancellation_reason").notNull().default("Calendar event no longer exists"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const cancelledJobsRelations = relations(cancelledJobs, ({ one }) => ({
  subscription: one(subscriptions, {
    fields: [cancelledJobs.subscriptionId],
    references: [subscriptions.id],
  }),
  property: one(properties, {
    fields: [cancelledJobs.propertyId],
    references: [properties.id],
  }),
}));
export const insertCancelledJobSchema = createInsertSchema(cancelledJobs);
export const selectCancelledJobSchema = createSelectSchema(cancelledJobs);

export type CancelledJob = typeof cancelledJobs.$inferSelect;
export type NewCancelledJob = typeof cancelledJobs.$inferInsert;