import {
  pgTable,
  uuid,
  integer,
  text,
  varchar,
  boolean,
  timestamp,
  index,
  date,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { customers } from "./customers.schema";
import { properties } from "./properties.schema";

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    stripeSubscriptionId: text("stripe_subscription_id").unique(),
    durationMonths: integer("duration_months").notNull(),
    status: varchar("status", {
      enum: ["active", "expired", "canceled", "pending"],
    })
      .default("pending")
      .notNull(),
    firstCleanPaymentId: text("first_clean_payment_id").unique(),
    isFirstCleanPrepaid: boolean("is_first_clean_prepaid")
      .default(false)
      .notNull(),
    iCalSyncFailed: boolean("ical_sync_failed").default(false),
    lastSyncAttempt: timestamp("last_sync_attempt"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("subscriptions_customer_idx").on(table.customerId),
    index("subscriptions_property_idx").on(table.propertyId),
  ]
);

export const insertSubscriptionSchema = createInsertSchema(subscriptions);
export const selectSubscriptionSchema = createSelectSchema(subscriptions);

export type Subscription = z.infer<typeof selectSubscriptionSchema>;
export type NewSubscription = z.infer<typeof insertSubscriptionSchema>;
