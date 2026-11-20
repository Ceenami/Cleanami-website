import { pgTable, uuid, text, date, timestamp } from "drizzle-orm/pg-core";
import { subscriptions } from "./subscriptions.schema";
export const subscriptionTerms = pgTable("subscription_term_contracts", {
  subscriptionId: uuid("subscription_id").primaryKey().references(() => subscriptions.id),
  policy: text("policy").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  paymentIntentId: text("payment_intent_id").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
