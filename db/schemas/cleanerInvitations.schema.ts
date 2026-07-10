import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users.schema";

export const cleanerInvitationStatusEnum = pgEnum("cleaner_invitation_status", [
  "invited",
  "signed_up",
  "disabled",
]);

export const cleanerInvitations = pgTable(
  "cleaner_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    status: cleanerInvitationStatusEnum("status").default("invited").notNull(),
    invitedAt: timestamp("invited_at").defaultNow().notNull(),
    invitedBy: uuid("invited_by").references(() => users.id, {
      onDelete: "set null",
    }),
    signedUpAt: timestamp("signed_up_at"),
    disabledAt: timestamp("disabled_at"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("cleaner_invitations_email_idx").on(table.email)]
);
