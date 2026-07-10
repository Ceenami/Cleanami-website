import {
  pgTable,
  uuid,
  timestamp,
  pgEnum,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users.schema";
import { cleaners } from "./cleaners.schema";
import { cleanerInvitations } from "./cleanerInvitations.schema";

export const cleanerAuditActionEnum = pgEnum("cleaner_audit_action", [
  "invitation_created",
  "invitation_removed",
  "invitation_disabled",
  "signup_rejected",
  "signup_succeeded",
  "onboarding_started",
  "onboarding_completed",
  "stripe_onboarding_started",
  "stripe_onboarding_completed",
  "account_activated",
  "account_suspended",
  "account_reactivated",
]);

export const cleanerAuditLogs = pgTable(
  "cleaner_audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cleanerId: uuid("cleaner_id").references(() => cleaners.id, {
      onDelete: "set null",
    }),
    invitationId: uuid("invitation_id").references(() => cleanerInvitations.id, {
      onDelete: "set null",
    }),
    action: cleanerAuditActionEnum("action").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("cleaner_audit_logs_cleaner_idx").on(table.cleanerId),
    index("cleaner_audit_logs_created_idx").on(table.createdAt),
  ]
);
