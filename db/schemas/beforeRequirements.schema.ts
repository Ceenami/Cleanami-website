import { pgTable, uuid, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { jobExecutionContracts } from "./jobExecution.schema";
import type { RoomPhotoRequirement } from "@/lib/cleaner/evidence";

export const beforeRequirements = pgTable("job_before_requirements", {
  jobId: uuid("job_id").primaryKey().references(() => jobExecutionContracts.jobId),
  rooms: jsonb("rooms").$type<RoomPhotoRequirement[]>().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  startedBy: text("started_by"),
  evidence: jsonb("evidence").$type<string[]>().notNull().default([]),
  exceptionReason: text("exception_reason"),
  exceptionBy: text("exception_by"),
  exceptionAt: timestamp("exception_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
