import { pgTable, uuid, timestamp, text, boolean, pgEnum, unique } from "drizzle-orm/pg-core";
import { cleaners } from "./cleaners.schema";

export const documentTypeEnum = pgEnum('document_type', ['w9', 'contractor_agreement', 'liability_waiver', 'privacy_consent']);

export const onboardingDocuments = pgTable('onboarding_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  cleanerId: uuid('cleaner_id').notNull().references(() => cleaners.id, { onDelete: 'cascade' }),
  documentType: documentTypeEnum('document_type').notNull(),
  signed: boolean('signed').default(false).notNull(),
  signedAt: timestamp('signed_at', { withTimezone: true }),
  documentUrl: text('document_url'),
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
},(table) => ({
  uniqueCleanerDocument: unique().on(table.cleanerId, table.documentType),
}));