import "server-only";
import { db, type Database } from "@/db";
import { beforeRequirements, evidenceUploadManifest, evidencePackets, jobs, jobOperationAudit } from "@/db/schemas";
import { eq } from "drizzle-orm";
import type { IssuedTerms } from "@/lib/jobs/execution-policy";
import { requirementSchema } from "@/lib/jobs/execution-policy";
import { isBeforeUpload } from "@/lib/evidence/phases";
import { z } from "zod";

type Writer = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];
export const requiredBeforeReady = () => process.env.BEFORE_REQUIRED_SCHEMA_READY === "true";
export class BeforeRequirementError extends Error { readonly status = 409; }
export async function enrollBeforeRequirements(writer: Writer, jobId: string, contract: IssuedTerms) {
  if (process.env.BEFORE_REQUIRED_ENROLLMENT !== "true") return;
  if (!requiredBeforeReady() || process.env.BEFORE_EVIDENCE_SCHEMA_READY !== "true") throw new BeforeRequirementError("Required Before evidence schema is not ready");
  // Arrival evidence describes the property, not proof of laundry performed later.
  await writer.insert(beforeRequirements).values({ jobId, rooms: contract.rooms.filter(room => room.roomKey !== "laundry") });
}
export async function readBeforeRequirements(jobId: string, writer: Writer = db) {
  if (!requiredBeforeReady()) return null;
  const [row] = await writer.select().from(beforeRequirements).where(eq(beforeRequirements.jobId, jobId));
  if (!row) return null;
  return { ...row, rooms: z.array(requirementSchema).min(1).parse(row.rooms) };
}
export async function beforeRequirementsStatus(jobId: string, writer: Writer = db) {
  const row = await readBeforeRequirements(jobId, writer);
  if (!row) return null;
  const uploads = await writer.select().from(evidenceUploadManifest).where(eq(evidenceUploadManifest.jobId, jobId));
  const before = uploads.filter(upload => isBeforeUpload(upload));
  const rooms = row.rooms.map(room => ({ ...room, saved: before.filter(upload => upload.roomKey === room.roomKey && upload.state === "verified").length }));
  return { rooms, missing: rooms.filter(room => room.saved < room.minPhotos).map(room => room.label),
    pending: before.some(upload => upload.state === "reserved"), startedAt: row.startedAt?.toISOString() ?? null,
    exception: !!row.exceptionAt, exceptionReason: row.exceptionReason };
}
/** Authenticated admin only; no fabricated visit, start, GPS or payment state. */
export async function waiveBeforeRequirements(jobId: string, actor: string, reason: string) {
  const value = z.string().trim().min(10).max(1000).parse(reason);
  return db.transaction(async tx => {
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId)).for("update");
    const row = await readBeforeRequirements(jobId, tx);
    if (!job || !row) throw new BeforeRequirementError("No required Before workflow for this job");
    const [packet] = await tx.select().from(evidencePackets).where(eq(evidencePackets.jobId, jobId));
    if (packet?.finalEvidenceSubmittedAt || job.status === "canceled" || job.paymentStatus === "refunded") throw new BeforeRequirementError("This job cannot receive an exception");
    if (row.startedAt) throw new BeforeRequirementError("Cleaning has already started");
    if (row.exceptionAt) {
      if (row.exceptionReason !== value) throw new BeforeRequirementError("An exception is already recorded; refresh to review it");
      return { success: true, alreadyRecorded: true };
    }
    await tx.update(beforeRequirements).set({ exceptionReason: value, exceptionBy: actor, exceptionAt: new Date() }).where(eq(beforeRequirements.jobId, jobId));
    await tx.insert(jobOperationAudit).values({ jobId, actor, operation: "before_exception", identity: "first" }).onConflictDoNothing();
    return { success: true };
  });
}
