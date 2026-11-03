import "server-only";
import { db } from "@/db";
import { jobs, jobsToCleaners, phase2cAudit } from "@/db/schemas";
import { and, desc, eq, sql } from "drizzle-orm";
import { isChecklistSnapshot } from "@/lib/cleaner/checklist-snapshot";
import {
  uploadStatusSchema,
  type UploadStatusReport,
} from "@/lib/cleaner/upload-status";
import { validCaptureTime } from "@/lib/cleaner/evidence-input";
import { getExecutionContract } from "./job-execution-contract";
import { effectiveChecklist } from "./effective-checklist";

export async function recordEvidenceUploadStatus(
  cleanerId: string,
  jobId: string,
  input: UploadStatusReport,
) {
  const report = uploadStatusSchema.parse(input);
  return db.transaction(async (tx) => {
    // Same job-first lock order as final evidence; no client can rewrite final state.
    await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .for("update");
    const assignment = await tx.query.jobsToCleaners.findFirst({
      where: and(
        eq(jobsToCleaners.cleanerId, cleanerId),
        eq(jobsToCleaners.jobId, jobId),
      ),
    });
    if (!assignment || !["primary", "laundry_lead"].includes(assignment.role))
      throw new Error("Working assignment required");
    const job = await tx.query.jobs.findFirst({
      where: eq(jobs.id, jobId),
      with: { evidencePacket: true },
    });
    if (
      !job ||
      !["in-progress", "completed_pending_evidence"].includes(
        job.status ?? "",
      ) ||
      job.evidencePacket?.finalEvidenceSubmittedAt
    )
      throw new Error("Evidence is no longer writable");
    const contract = await getExecutionContract(jobId, tx);
    const snapshot = await effectiveChecklist(jobId, job.checklistSnapshot, tx);
    const rooms = contract?.rooms ?? snapshot?.photoRequirements;
    if (
      !rooms?.some(
        (room) => room.roomKey === report.roomKey,
      )
    )
      throw new Error("Unknown evidence room");
    if (
      !validCaptureTime(
        report.capturedAt,
        job.evidencePacket?.gpsCheckInTimestamp ?? null,
        contract ? null : job.evidencePacket?.gpsCheckOutTimestamp ?? null,
      )
    )
      throw new Error("Capture must belong to this visit");
    const [existing] = await tx
      .select()
      .from(phase2cAudit)
      .where(
        and(
          eq(phase2cAudit.subjectId, jobId),
          eq(phase2cAudit.actorId, cleanerId),
          eq(phase2cAudit.kind, "evidence_upload_state"),
          sql`${phase2cAudit.payload}->>'uploadId' = ${report.uploadId}`,
        ),
      )
      .orderBy(desc(sql`(${phase2cAudit.payload}->>'revision')::bigint`))
      .limit(1);
    if (existing) {
      const previous = uploadStatusSchema.parse(existing.payload);
      if (
        previous.roomKey !== report.roomKey ||
        previous.capturedAt !== report.capturedAt
      )
        throw new Error("Upload identity belongs to another capture");
      if (previous.revision >= report.revision) return;
    }
    await tx.insert(phase2cAudit).values({
      subjectId: jobId,
      actorId: cleanerId,
      kind: "evidence_upload_state",
      payload: report,
    });
  });
}
