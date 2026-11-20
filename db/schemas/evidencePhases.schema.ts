import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";
import { evidenceUploadManifest, jobExecutionContracts } from "./jobExecution.schema";

// Sidecars preserve the legacy manifest/contract schema and historical meaning.
export const evidenceUploadPhases = pgTable("evidence_upload_phases", {
  uploadId: uuid("upload_id").primaryKey().references(() => evidenceUploadManifest.uploadId),
  phase: text("phase").notNull(),
});
export const jobArrivalConditions = pgTable("job_arrival_conditions", {
  jobId: uuid("job_id").primaryKey().references(() => jobExecutionContracts.jobId),
  revision: integer("revision").notNull().default(0), notes: text("notes").notNull().default(""),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
