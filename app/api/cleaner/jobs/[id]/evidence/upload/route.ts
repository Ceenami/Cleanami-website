import { executionResponse, executionLegacyUpload } from "@/lib/services/job-execution-http";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  evidencePackets,
  jobs,
  jobsToCleaners,
  phase2cAudit,
} from "@/db/schemas";
import { validCaptureTime } from "@/lib/cleaner/evidence-input";
import { recordEvidenceUploadStatus } from "@/lib/services/evidence-upload-status";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { ensureIssuedChecklist } from "@/lib/services/property-checklists";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import {
  cleanerAuthErrorStatus,
  getCleanerAuth,
  requireCleanerJobAssignment,
} from "@/lib/cleaner-auth";
import { EVIDENCE_BUCKET, createSignedUrl } from "@/lib/storage/signed-url";

const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_SIZE = 2 * 1024 * 1024;

/**
 * How old a photo may be at upload time. Generous enough for a cleaner who
 * photographs a room, finishes the rest of the property and only then taps Save
 * Progress; short enough that yesterday's photo is refused.
 */
const MAX_PHOTO_AGE_MS = 6 * 60 * 60 * 1000;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { cleanerId, error } = await getCleanerAuth();
  if (!cleanerId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized" },
      { status: cleanerAuthErrorStatus(error) },
    );
  }

  const { id: jobId } = await params;
  const { assignment, error: assignmentError } =
    await requireCleanerJobAssignment(cleanerId, jobId);

  if (assignmentError) {
    return NextResponse.json({ error: assignmentError }, { status: 403 });
  }
  if (!assignment || !["primary", "laundry_lead"].includes(assignment.role))
    return NextResponse.json(
      { error: "Only the working team may upload evidence" },
      { status: 403 },
    );

  const issuedResponse = await executionResponse(jobId, () => executionLegacyUpload(request, jobId, cleanerId));
  if (issuedResponse) return issuedResponse;

  try {
    // Installed-client compatibility: gallery files may omit capture time while
    // a visit is active. A supplied camera timestamp must still belong to it.
    const job = await db.query.jobs.findFirst({
      where: eq(jobs.id, jobId),
      columns: { status: true, checklistSnapshot: true, addonsSnapshot: true },
      with: { property: { with: { checklistFiles: true } } },
    });

    if (
      job?.status !== "in-progress" &&
      job?.status !== "completed_pending_evidence"
    ) {
      return NextResponse.json(
        {
          error:
            "Evidence photos can only be uploaded while evidence is still pending.",
        },
        { status: 409 },
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const roomKey = formData.get("roomKey") as string | null;
    const capturedAtRaw = formData.get("capturedAt") as string | null;
    const clientId = formData.get("clientUploadId") as string | null;
    const reportRevision = Number(formData.get("reportRevision") ?? 0);
    if (
      !Number.isSafeInteger(reportRevision) ||
      reportRevision < 0 ||
      reportRevision >= Number.MAX_SAFE_INTEGER
    )
      return NextResponse.json(
        { error: "Invalid upload revision" },
        { status: 400 },
      );

    if (!(file instanceof File) || !roomKey) {
      return NextResponse.json(
        { error: "file and roomKey are required" },
        { status: 400 },
      );
    }
    if (!job.property)
      return NextResponse.json(
        { error: "Property not found" },
        { status: 404 },
      );
    const snapshot = await ensureIssuedChecklist(
      jobId,
      { ...job.property, cleaningLevel: job.addonsSnapshot?.cleaningLevel },
      job.property.checklistFiles,
      job.checklistSnapshot,
    );
    if (!snapshot.photoRequirements!.some((r) => r.roomKey === roomKey))
      return NextResponse.json(
        { error: "Unknown evidence room" },
        { status: 400 },
      );
    if (clientId && !z.uuid().safeParse(clientId).success)
      return NextResponse.json(
        { error: "Invalid upload identity" },
        { status: 400 },
      );
    const visit = await db.query.evidencePackets.findFirst({
      where: eq(evidencePackets.jobId, jobId),
      columns: { gpsCheckInTimestamp: true, gpsCheckOutTimestamp: true },
    });
    if (
      !visit?.gpsCheckInTimestamp || (capturedAtRaw !== null && !validCaptureTime(
        capturedAtRaw,
        visit?.gpsCheckInTimestamp ?? null,
        visit?.gpsCheckOutTimestamp ?? null,
      ))
    )
      return NextResponse.json(
        { error: "Check in first; any supplied photo timestamp must belong to this visit" },
        { status: 400 },
      );

    let capturedAt: Date | null = null;
    if (capturedAtRaw) {
      capturedAt = new Date(capturedAtRaw);
      const ageMs = Date.now() - capturedAt.getTime();
      if (Number.isNaN(capturedAt.getTime()) || ageMs < 0) {
        return NextResponse.json(
          { error: "Invalid photo capture time" },
          { status: 400 },
        );
      }
      if (job.status === "in-progress" && ageMs > MAX_PHOTO_AGE_MS) {
        return NextResponse.json(
          {
            error:
              "This photo is too old to use as evidence. Please retake it.",
          },
          { status: 400 },
        );
      }
    }

    if (job.status === "completed_pending_evidence") {
      const packet = await db.query.evidencePackets.findFirst({
        where: eq(evidencePackets.jobId, jobId),
        columns: {
          gpsCheckInTimestamp: true,
          gpsCheckOutTimestamp: true,
        },
      });
      if (
        !capturedAt ||
        !packet?.gpsCheckInTimestamp ||
        !packet.gpsCheckOutTimestamp
      ) {
        return NextResponse.json(
          {
            error:
              "Later evidence uploads must include the recorded camera capture time.",
          },
          { status: 400 },
        );
      }
      if (
        capturedAt.getTime() < packet.gpsCheckInTimestamp.getTime() ||
        capturedAt.getTime() > packet.gpsCheckOutTimestamp.getTime()
      ) {
        return NextResponse.json(
          {
            error:
              "Evidence photos must have been captured during the recorded job window.",
          },
          { status: 400 },
        );
      }
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Only JPEG, PNG, and WebP images are allowed" },
        { status: 400 },
      );
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        {
          error: "Compress this photo to under 2MB before upload",
          retryable: false,
        },
        { status: 413 },
      );
    }

    const supabase = await createClient();
    const extension =
      file.type === "image/png"
        ? "png"
        : file.type === "image/webp"
          ? "webp"
          : "jpg";
    const filePath = `${cleanerId}/${jobId}/${roomKey}/${clientId ?? randomUUID()}.${extension}`;
    const contentHash = createHash("sha256")
      .update(Buffer.from(await file.arrayBuffer()))
      .digest("hex");

    const { error: uploadError } = await supabase.storage
      .from(EVIDENCE_BUCKET)
      .upload(filePath, file, { upsert: false });

    if (uploadError) {
      // Cleaner Storage policies intentionally grant INSERT without SELECT.
      // Probe only this authorized capture's exact path with the server client;
      // no broader object listing or public read grant is needed for retries.
      const { data: stored, error: readError } = await createAdminClient()
        .storage.from(EVIDENCE_BUCKET)
        .download(filePath);
      if (readError || !stored) {
        if (clientId && capturedAt)
          await recordEvidenceUploadStatus(cleanerId, jobId, {
            uploadId: clientId,
            roomKey,
            capturedAt: capturedAt.toISOString(),
            state: "failed",
            issue: "upload_failed",
            revision: reportRevision + 1,
          });
        return NextResponse.json(
          { error: "Upload failed; retained for retry", retryable: true },
          { status: 503 },
        );
      }
      const storedHash = createHash("sha256")
        .update(Buffer.from(await stored.arrayBuffer()))
        .digest("hex");
      if (storedHash !== contentHash)
        return NextResponse.json(
          {
            error:
              "This upload identity already belongs to a different capture.",
            retryable: false,
          },
          { status: 409 },
        );
    }

    // Persist the object path (returned as `path`); the bucket is private, so
    // hand back a short-lived signed URL only for immediate client preview.
    const auditError = await db.transaction(async (tx) => {
      const [currentJob] = await tx
        .select({ status: jobs.status })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .for("update");
      const currentAssignment = await tx.query.jobsToCleaners.findFirst({
        where: and(
          eq(jobsToCleaners.jobId, jobId),
          eq(jobsToCleaners.cleanerId, cleanerId),
        ),
      });
      const currentVisit = await tx.query.evidencePackets.findFirst({
        where: eq(evidencePackets.jobId, jobId),
      });
      if (
        !currentAssignment ||
        !["primary", "laundry_lead"].includes(currentAssignment.role) ||
        !currentJob ||
        !["in-progress", "completed_pending_evidence"].includes(
          currentJob.status ?? "",
        ) ||
        currentVisit?.finalEvidenceSubmittedAt ||
        !currentVisit?.gpsCheckInTimestamp ||
        (!capturedAtRaw && currentJob.status !== "in-progress") ||
        (capturedAtRaw !== null && !validCaptureTime(
          capturedAtRaw,
          currentVisit?.gpsCheckInTimestamp ?? null,
          currentVisit?.gpsCheckOutTimestamp ?? null,
        ))
      )
        return "The visit changed; evidence is no longer writable.";
      const existing = await tx.query.phase2cAudit.findFirst({
        where: and(
          eq(phase2cAudit.subjectId, jobId),
          eq(phase2cAudit.kind, "evidence_photo_uploaded"),
          sql`${phase2cAudit.payload}->>'path' = ${filePath}`,
        ),
      });
      if (existing) {
        const previous = existing.payload as Record<string, unknown>;
        if (
          previous.capturedAt !== capturedAt?.toISOString() ||
          (previous.contentHash && previous.contentHash !== contentHash)
        )
          return "This upload identity already belongs to a different capture.";
        return null;
      }
      await tx.insert(phase2cAudit).values({
        subjectId: jobId,
        actorId: cleanerId,
        kind: "evidence_photo_uploaded",
        payload: {
          path: filePath,
          roomKey,
          capturedAt: capturedAt?.toISOString(),
          clientUploadId: clientId,
          contentHash,
          timestampSource: capturedAt ? "client_reported" : "unknown_gallery_capture",
        },
      });
      return null;
    });
    if (auditError)
      return NextResponse.json(
        { error: auditError, retryable: false },
        { status: 409 },
      );
    const previewUrl = await createSignedUrl(EVIDENCE_BUCKET, filePath);

    return NextResponse.json({ path: filePath, url: previewUrl, roomKey });
  } catch (err) {
    console.error("[POST /api/cleaner/jobs/[id]/evidence/upload]", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
