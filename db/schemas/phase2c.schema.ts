import {
  pgTable,
  uuid,
  integer,
  jsonb,
  text,
  timestamp,
  date,
  boolean,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { properties } from "./properties.schema";
import { cleaners } from "./cleaners.schema";
import { jobs } from "./jobs.schema";
import type { ChecklistDraft } from "@/lib/checklists/rental-library";
import type { IssuedChecklistItem } from "@/lib/cleaner/checklist-snapshot";

export const propertyChecklistState = pgTable("phase2c_property_checklists", {
  propertyId: uuid("property_id")
    .primaryKey()
    .references(() => properties.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull().default(0),
  publishedRevision: integer("published_revision").notNull().default(0),
  draft: jsonb("draft").$type<ChecklistDraft>(),
  published: jsonb("published").$type<IssuedChecklistItem[]>(),
  status: text("status").notNull().default("basic"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const phase2cAudit = pgTable(
  "phase2c_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subjectId: uuid("subject_id").notNull(),
    kind: text("kind").notNull(),
    actorId: text("actor_id").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("phase2c_audit_subject_idx").on(t.subjectId, t.createdAt)],
);
export const availabilityDays = pgTable(
  "phase2c_availability_days",
  {
    cleanerId: uuid("cleaner_id")
      .notNull()
      .references(() => cleaners.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    isAvailable: boolean("is_available").notNull(),
    onCallEligible: boolean("on_call_eligible").notNull(),
    openPoolEligible: boolean("open_pool_eligible").notNull(),
    revision: integer("revision").notNull().default(1),
    late: boolean("late").notNull().default(false),
    reopenedUntil: timestamp("reopened_until", { withTimezone: true }),
    actorId: text("actor_id").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.cleanerId, t.date] }),
    index("phase2c_availability_date_idx").on(t.date),
  ],
);
export const propertyExclusions = pgTable(
  "phase2c_property_exclusions",
  {
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    cleanerId: uuid("cleaner_id")
      .notNull()
      .references(() => cleaners.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    actorId: text("actor_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.propertyId, t.cleanerId] }),
    index("phase2c_exclusion_cleaner_idx").on(t.cleanerId),
  ],
);
export const assignmentRuns = pgTable(
  "phase2c_assignment_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    outcome: text("outcome").notNull(),
    candidates: jsonb("candidates")
      .$type<
        Array<{
          cleanerId: string;
          source: string;
          reasons: string[];
          selected?: boolean;
          selectedRole?: string | null;
        }>
      >()
      .notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    policyVersion: text("policy_version").notNull().default("phase2c-v1"),
    actorId: text("actor_id"),
    context: jsonb("context").$type<Record<string, unknown>>(),
  },
  (t) => [index("phase2c_assignment_job_idx").on(t.jobId, t.createdAt)],
);
export const propertyAssignmentPolicy = pgTable("phase2c_property_policy", {
  propertyId: uuid("property_id")
    .primaryKey()
    .references(() => properties.id, { onDelete: "cascade" }),
  hotTubRequired: boolean("hot_tub_required").notNull().default(false),
  laundryLeadRequired: boolean("laundry_lead_required")
    .notNull()
    .default(false),
  adminNotes: text("admin_notes").notNull().default(""),
  revision: integer("revision").notNull().default(1),
  actorId: text("actor_id").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const publicJobNotes = pgTable(
  "phase2c_public_job_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    category: text("category").notNull(),
    actorId: text("actor_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("phase2c_public_notes_job_idx").on(t.jobId)],
);
export const evidenceDrafts = pgTable(
  "phase2c_evidence_drafts",
  {
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    cleanerId: uuid("cleaner_id")
      .notNull()
      .references(() => cleaners.id, { onDelete: "cascade" }),
    explanations: jsonb("explanations")
      .$type<Record<string, string>>()
      .notNull(),
    state: jsonb("state").$type<{
      checklistLog: {
        items: Array<{
          id: string;
          task: string;
          completed: boolean;
          section?: string;
        }>;
        roomPhotos?: Record<string, string[]>;
      };
      cleanerNotes: string;
    }>(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.jobId, t.cleanerId] }),
    index("phase2c_draft_cleaner_idx").on(t.cleanerId),
  ],
);
export const reminderDeliveries = pgTable(
  "phase2c_reminder_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cleanerId: uuid("cleaner_id")
      .notNull()
      .references(() => cleaners.id, { onDelete: "cascade" }),
    periodStart: date("period_start").notNull(),
    stage: text("stage").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("phase2c_reminder_dedupe_idx").on(
      t.cleanerId,
      t.periodStart,
      t.stage,
    ),
    index("phase2c_reminder_status_idx").on(t.status),
  ],
);
