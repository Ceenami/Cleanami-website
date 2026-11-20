import "server-only";
import { db } from "@/db";
import { jobs, properties, evidenceUploadManifest, evidenceUploadPhases, jobArrivalConditions } from "@/db/schemas";
import { and, eq, inArray } from "drizzle-orm";
import { beforeEvidenceSchemaReady } from "./before-evidence-settings";
import { createSignedUrls, EVIDENCE_BUCKET } from "@/lib/storage/signed-url";
import { isBeforeUpload } from "@/lib/evidence/phases";
import { getExecutionContract } from "./job-execution-contract";

export type PhaseEvidenceView = { available: boolean; notes: string | null; photos: Array<{
  id: string; room: string; phase: "before" | "after" | "unrecorded"; url: string | null;
  capturedAt: string | null; uploadedAt: string;
}> };
export class PhaseEvidenceNotFound extends Error {}
export async function loadPhaseEvidence(jobId: string, customerId?: string): Promise<PhaseEvidenceView> {
  // Ownership is in the SQL predicate before reading any evidence or minting URLs.
  const job = await db.query.jobs.findFirst({ where: and(eq(jobs.id, jobId), customerId
    ? inArray(jobs.propertyId, db.select({ id: properties.id }).from(properties).where(eq(properties.customerId, customerId))) : undefined),
    columns: { id: true }, with: { evidencePacket: { columns: { finalEvidenceSubmittedAt: true } } } });
  if (!job) throw new PhaseEvidenceNotFound();
  if (!beforeEvidenceSchemaReady()) return { available: false, notes: null, photos: [] };
  // Customer reports never expose the working team's private draft/arrival notes.
  if (customerId && !job.evidencePacket?.finalEvidenceSubmittedAt) return { available: true, notes: null, photos: [] };
  const uploads = await db.select({ upload: evidenceUploadManifest, phase: evidenceUploadPhases.phase }).from(evidenceUploadManifest)
    .leftJoin(evidenceUploadPhases, eq(evidenceUploadPhases.uploadId, evidenceUploadManifest.uploadId))
    .where(and(eq(evidenceUploadManifest.jobId, jobId), eq(evidenceUploadManifest.state, "verified")));
  const issued = await getExecutionContract(jobId);
  const urls = await createSignedUrls(EVIDENCE_BUCKET, uploads.map(u => u.upload.path));
  const notes = customerId ? [] : await db.select({ notes: jobArrivalConditions.notes }).from(jobArrivalConditions).where(eq(jobArrivalConditions.jobId, jobId));
  return { available: true, notes: notes[0]?.notes ?? null, photos: uploads.map(({ upload, phase }, index) => ({
    id: upload.uploadId, room: issued?.rooms.find(r => r.roomKey === upload.roomKey)?.label ?? upload.roomKey,
    phase: isBeforeUpload(upload, phase ?? undefined) ? "before" : phase === "after" ? "after" : "unrecorded",
    url: urls[index] ?? null, capturedAt: upload.capturedAt?.toISOString() ?? null, uploadedAt: upload.createdAt.toISOString(),
  })) };
}
