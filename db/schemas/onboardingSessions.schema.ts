import { pgTable, uuid, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export const onboardingSessions = pgTable(
  "onboarding_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionToken: uuid("session_token").defaultRandom().notNull().unique(),
    
    email: text("email"),
    phone: text("phone"),
    name: text("name"),
    
    currentStep: integer("current_step").default(1).notNull(),
    
    formData: jsonb("form_data").$type<Record<string, unknown>>().default({}).notNull(),
    
    priceDetails: jsonb("price_details").$type<Record<string, unknown>>(),
    
    hasBookedCall: timestamp("has_booked_call", { withTimezone: true }),
    
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("onboarding_sessions_email_idx").on(table.email),
    index("onboarding_sessions_session_token_idx").on(table.sessionToken),
    index("onboarding_sessions_expires_at_idx").on(table.expiresAt),
  ]
);

export type OnboardingSession = typeof onboardingSessions.$inferSelect;
export type NewOnboardingSession = typeof onboardingSessions.$inferInsert;