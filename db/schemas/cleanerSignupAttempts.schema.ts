import { pgTable, uuid, text, timestamp, boolean, index } from "drizzle-orm/pg-core";

export const cleanerSignupAttempts = pgTable(
  "cleaner_signup_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    success: boolean("success").default(false).notNull(),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("cleaner_signup_attempts_email_idx").on(table.email)]
);
