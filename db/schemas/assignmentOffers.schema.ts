import { sql } from "drizzle-orm";
import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { jobs } from "./jobs.schema";
import { cleaners } from "./cleaners.schema";
import { swapRequests } from "./swapRequests.schema";

// 0058 is the reviewed authority for checks, private grants and transition triggers.
export const offerJobs = pgTable("phase3a_offer_jobs", {
  jobId: uuid("job_id").primaryKey().references(() => jobs.id, { onDelete: "cascade" }),
  scheduleVersion: integer("schedule_version").notNull().default(1),
  changeVersion: integer("change_version").notNull().default(1),
  needsDispatch: boolean("needs_dispatch").notNull().default(true),
  lifecycleEnabled: boolean("lifecycle_enabled").notNull().default(false),
  automationPolicy: text("automation_policy"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const assignmentOffers = pgTable("phase3a_assignment_offers", {
  id: uuid("id").primaryKey().defaultRandom(),
  version: integer("version").generatedAlwaysAsIdentity().notNull().unique(),
  jobId: uuid("job_id").notNull().references(() => offerJobs.jobId, { onDelete: "cascade" }),
  cleanerId: uuid("cleaner_id").notNull().references(() => cleaners.id),
  role: text("role").notNull(),
  pairedWorkerId: uuid("paired_worker_id").references(() => cleaners.id),
  replacesCleanerId: uuid("replaces_cleaner_id").references(() => cleaners.id),
  swapRequestId: uuid("swap_request_id").references(() => swapRequests.id),
  scheduleVersion: integer("schedule_version").notNull(),
  state: text("state").notNull().default("pending"),
  offeredAt: timestamp("offered_at", { withTimezone: true }).notNull().defaultNow(),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  reason: text("reason"),
  dispatchState: text("dispatch_state").notNull().default("pending"),
  dispatchAt: timestamp("dispatch_at", { withTimezone: true }),
  responseDueAt: timestamp("response_due_at", { withTimezone: true }),
  responseReminderAt: timestamp("response_reminder_at", { withTimezone: true }),
  deadlineGate: text("deadline_gate"),
}, table => [
  uniqueIndex("phase3a_offer_current_cleaner").on(table.jobId, table.cleanerId).where(sql`${table.state} in ('pending','accepted')`),
  uniqueIndex("phase3a_offer_current_pair").on(table.jobId, table.pairedWorkerId).where(sql`${table.role}='backup' and ${table.state} in ('pending','accepted')`),
  index("phase3a_offer_dispatch").on(table.offeredAt).where(sql`${table.state}='pending' and ${table.dispatchState}='pending'`),
  index("phase3a_offer_job_history").on(table.jobId, table.version),
  index("phase3a_offer_due").on(table.responseDueAt).where(sql`${table.state}='pending' and ${table.responseDueAt} is not null`),
]);
export const offerEvents = pgTable("phase3a_offer_events", {
  id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
  offerId: uuid("offer_id").notNull().references(() => assignmentOffers.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), actorId: text("actor_id").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(), reason: text("reason"),
  assignmentTerms: jsonb("assignment_terms"),
}, table => [index("phase3a_offer_event_history").on(table.offerId, table.id)]);
export const coverageAlerts = pgTable("phase3a_coverage_alerts", {
  jobId: uuid("job_id").notNull().references(() => offerJobs.jobId, { onDelete: "cascade" }),
  identity: text("identity").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.jobId, table.identity] })]);

// 0060 is the reviewed authority for priority identity/history and coordination guards.
export const priorityPlans = pgTable("phase3a_priority_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  targetJobId: uuid("target_job_id").notNull().references(() => offerJobs.jobId),
  donorJobId: uuid("donor_job_id").notNull().references(() => offerJobs.jobId),
  cleanerId: uuid("cleaner_id").notNull().references(() => cleaners.id),
  donorOfferId: uuid("donor_offer_id").notNull().references(() => assignmentOffers.id),
  replacementOfferId: uuid("replacement_offer_id").notNull().unique().references(() => assignmentOffers.id),
  targetTeam: jsonb("target_team").notNull().$type<Array<{ cleanerId: string; role: "primary" | "laundry_lead" }>>(),
  targetFingerprint: jsonb("target_fingerprint").notNull(), donorFingerprint: jsonb("donor_fingerprint").notNull(),
  state: text("state").notNull().default("pending"), reason: text("reason"), actorId: text("actor_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, table => [
  uniqueIndex("phase3a_priority_active_target").on(table.targetJobId).where(sql`${table.state}='pending'`),
  uniqueIndex("phase3a_priority_active_donor").on(table.donorJobId).where(sql`${table.state}='pending'`),
  uniqueIndex("phase3a_priority_active_cleaner").on(table.cleanerId).where(sql`${table.state}='pending'`),
  index("phase3a_priority_target_history").on(table.targetJobId, table.createdAt),
  index("phase3a_priority_donor_history").on(table.donorJobId, table.createdAt),
]);
export const priorityMoveApprovals = pgTable("phase3a_priority_move_approvals", {
  planId: uuid("plan_id").primaryKey().references(() => priorityPlans.id),
  cleanerId: uuid("cleaner_id").notNull().references(() => cleaners.id),
  targetScheduleVersion: integer("target_schedule_version").notNull(), details: jsonb("details").notNull(),
  offeredAt: timestamp("offered_at", { withTimezone: true }).notNull().defaultNow(),
  responseDueAt: timestamp("response_due_at", { withTimezone: true }).notNull(),
  reminderAt: timestamp("reminder_at", { withTimezone: true }).notNull(),
  state: text("state").notNull().default("pending"),
  respondedAt: timestamp("responded_at", { withTimezone: true }), reason: text("reason"),
}, t => [index("phase3a_priority_approval_cleaner").on(t.cleanerId, t.offeredAt)]);

export const priorityEvents = pgTable("phase3a_priority_events", {
  id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
  planId: uuid("plan_id").notNull().references(() => priorityPlans.id), state: text("state").notNull(), reason: text("reason"),
  actorId: text("actor_id").notNull(), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("phase3a_priority_event_history").on(table.planId, table.id)]);
export const priorityNotices = pgTable("phase3a_priority_notices", {
  id: uuid("id").primaryKey().defaultRandom(), planId: uuid("plan_id").notNull().references(() => priorityPlans.id),
  state: text("state").notNull(), jobId: uuid("job_id").notNull().references(() => jobs.id), audience: text("audience").notNull(),
  cleanerId: uuid("cleaner_id").references(() => cleaners.id), dispatchState: text("dispatch_state").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), claimedAt: timestamp("claimed_at", { withTimezone: true }),
}, table => [
  uniqueIndex("phase3a_priority_notice_identity").on(table.planId, table.state, table.jobId, table.audience, sql`coalesce(${table.cleanerId},'00000000-0000-0000-0000-000000000000'::uuid)`),
  index("phase3a_priority_notice_pending").on(table.createdAt, table.id).where(sql`${table.dispatchState}='pending'`),
  index("phase3a_priority_notice_job").on(table.jobId).where(sql`${table.dispatchState} in ('claimed','failed')`),
]);

export const reconfirmations = pgTable("phase3a_reconfirmations", {
  id: uuid("id").primaryKey().defaultRandom(),
  offerId: uuid("offer_id").notNull().unique().references(() => assignmentOffers.id, { onDelete: "cascade" }),
  scheduleVersion: integer("schedule_version").notNull(),
  plannedStart: timestamp("planned_start", { withTimezone: true }).notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
  reminderAt: timestamp("reminder_at", { withTimezone: true }).notNull(),
  escalateAt: timestamp("escalate_at", { withTimezone: true }).notNull(),
  state: text("state").notNull().default("pending"),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, table => [index("phase3a_reconfirmation_due").on(table.escalateAt).where(sql`${table.state}='pending'`)]);

export const lifecycleActions = pgTable("phase3a_lifecycle_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  offerId: uuid("offer_id").notNull().references(() => assignmentOffers.id, { onDelete: "cascade" }),
  reconfirmationId: uuid("reconfirmation_id").references(() => reconfirmations.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  details: jsonb("details").notNull().default({}),
  dispatchState: text("dispatch_state").notNull().default("pending"),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
}, table => [
  uniqueIndex("phase3a_lifecycle_action_identity").on(table.offerId, table.kind),
  index("phase3a_lifecycle_pending").on(table.occurredAt, table.id).where(sql`${table.dispatchState}='pending'`),
]);
