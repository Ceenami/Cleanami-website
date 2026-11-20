import { pgTable, uuid, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";

// Server-owned financial history. SQL0067 supplies restrictive FKs, checked
// transitions, ledger invariants and private grants; never cascade this history.
export const prepaidEntitlements = pgTable("prepaid_entitlements", {
  id: uuid("id").primaryKey().defaultRandom(), customerId: uuid("customer_id").notNull(),
  propertyId: uuid("property_id").notNull(), sourcePaymentId: text("source_payment_id").notNull().unique(),
  fundedCents: integer("funded_cents").notNull(), purchase: jsonb("purchase").notNull(),
  state: text("state").notNull().default("active"), holdReason: text("hold_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [index("prepaid_owner_property").on(t.customerId, t.propertyId)]);
export const rentalFinanceContracts = pgTable("rental_finance_contracts", {
  subscriptionId: uuid("subscription_id").primaryKey(), customerId: uuid("customer_id").notNull(),
  propertyId: uuid("property_id").notNull(), entitlementId: uuid("entitlement_id").notNull(),
  policy: text("policy").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  reactivationTerms: jsonb("reactivation_terms").$type<{ startDate: string; endDate: string; minimumEndsAt: string; requestId: string; sourceSubscriptionId: string } | null>(),
}, t => [index("rental_finance_entitlement").on(t.entitlementId)]);
export const prepaidEntries = pgTable("prepaid_entries", {
  id: uuid("id").primaryKey().defaultRandom(), entitlementId: uuid("entitlement_id").notNull(),
  jobId: uuid("job_id"), kind: text("kind").notNull(), cents: integer("cents").notNull(),
  identity: text("identity").notNull().unique(), actor: text("actor").notNull(), reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [index("prepaid_entries_entitlement").on(t.entitlementId), index("prepaid_entries_job").on(t.jobId)]);
export const prepaidReservations = pgTable("prepaid_reservations", {
  jobId: uuid("job_id").primaryKey(), entitlementId: uuid("entitlement_id").notNull(),
  cents: integer("cents").notNull(), state: text("state").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [index("prepaid_reservations_entitlement").on(t.entitlementId)]);
export const rentalJobFinances = pgTable("rental_job_finances", {
  jobId: uuid("job_id").primaryKey(), subscriptionId: uuid("subscription_id").notNull(),
  customerId: uuid("customer_id").notNull(), propertyId: uuid("property_id").notNull(),
  quote: jsonb("quote").notNull(), scope: text("scope").notNull(), completionCents: integer("completion_cents"),
  topupConsentCents: integer("topup_consent_cents"), topupConsentActor: text("topup_consent_actor"),
  cancellation: text("cancellation"), canceledAt: timestamp("canceled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [index("rental_finance_job_subscription").on(t.subscriptionId), index("rental_finance_job_owner").on(t.customerId, t.propertyId)]);
export const rentalFinancialOperations = pgTable("rental_financial_operations", {
  id: uuid("id").primaryKey().defaultRandom(), identity: text("identity").notNull().unique(),
  jobId: uuid("job_id"), entitlementId: uuid("entitlement_id"), kind: text("kind").notNull(),
  cents: integer("cents").notNull(), params: jsonb("params").notNull(),
  state: text("state").notNull().default("prepared"), providerId: text("provider_id").unique(),
  token: uuid("token"), claimedAt: timestamp("claimed_at", { withTimezone: true }),
  lastError: text("last_error"), actor: text("actor").notNull(), reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [index("rental_finance_operation_job").on(t.jobId), index("rental_finance_operation_entitlement").on(t.entitlementId), index("rental_finance_operation_state").on(t.state)]);
export const rentalFinanceNotices = pgTable("rental_finance_notices", {
  identity: text("identity").primaryKey(), customerId: uuid("customer_id").notNull(), jobId: uuid("job_id"),
  subject: text("subject").notNull(), lines: jsonb("lines").$type<string[]>().notNull(),
  state: text("state").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [index("rental_finance_notice_customer").on(t.customerId), index("rental_finance_notice_job").on(t.jobId)]);
export const rentalFinanceAudit = pgTable("rental_finance_audit", {
  identity: text("identity").primaryKey(), jobId: uuid("job_id"), entitlementId: uuid("entitlement_id"),
  actor: text("actor").notNull(), action: text("action").notNull(), reason: text("reason").notNull(),
  details: jsonb("details").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [index("rental_finance_audit_job").on(t.jobId), index("rental_finance_audit_entitlement").on(t.entitlementId)]);
