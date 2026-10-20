import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { jobs } from "./jobs.schema";
import type { IssuedTerms } from "@/lib/jobs/execution-policy";

export const jobExecutionContracts = pgTable("job_execution_contracts", {
  jobId: uuid("job_id")
    .primaryKey()
    .references(() => jobs.id),
  protocol: text("protocol").notNull(),
  terms: jsonb("terms").$type<IssuedTerms>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const evidenceUploadManifest = pgTable(
  "evidence_upload_manifest",
  {
    uploadId: uuid("upload_id").primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobExecutionContracts.jobId),
    cleanerId: uuid("cleaner_id").notNull(),
    roomKey: text("room_key").notNull(),
    path: text("path").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    byteSize: integer("byte_size").notNull(),
    mime: text("mime").notNull(),
    sha256: text("sha256").notNull(),
    state: text("state").notNull().default("reserved"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("evidence_upload_path_uidx").on(t.path),
    index("evidence_upload_job_idx").on(t.jobId),
  ],
);
export type DraftItem = {
  id: string;
  task: string;
  completed: boolean;
  section?: string;
};
export const jobEvidenceDrafts = pgTable("job_evidence_drafts", {
  jobId: uuid("job_id")
    .primaryKey()
    .references(() => jobExecutionContracts.jobId),
  revision: integer("revision").notNull().default(0),
  items: jsonb("items").$type<DraftItem[]>().notNull().default([]),
  notes: text("notes").notNull().default(""),
  finalHash: text("final_hash"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const jobOperationAudit = pgTable(
  "job_operation_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobExecutionContracts.jobId),
    operation: text("operation").notNull(),
    identity: text("identity").notNull(),
    actor: text("actor").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("job_operation_identity_uidx").on(
      t.jobId,
      t.operation,
      t.identity,
    ),
  ],
);
