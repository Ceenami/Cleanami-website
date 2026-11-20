import { pgTable, uuid, text, date, timestamp } from "drizzle-orm/pg-core";
import { subscriptions } from "./subscriptions.schema";

// Private immutable commitment snapshot. Absence means the original month policy.
export const subscriptionMinimums = pgTable("subscription_minimums", {
  subscriptionId: uuid("subscription_id").primaryKey().references(() => subscriptions.id, { onDelete: "cascade" }),
  policy: text("policy").notNull(),
  startDate: date("start_date").notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  paymentIntentId: text("payment_intent_id").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
