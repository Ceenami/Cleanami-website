import { executionResponse } from "@/lib/services/job-execution-http";
import { ExecutionError, saveExecutionDraft } from "@/lib/services/job-execution";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import {
  evidencePackets,
  jobs,
  jobsToCleaners,
  evidenceDrafts,
} from "@/db/schemas";
import { evidenceInputSchema } from "@/lib/cleaner/evidence-input";
import {
  cleanerAuthErrorStatus,
  getCleanerAuth,
  requireCleanerJobAssignment,
} from "@/lib/cleaner-auth";
import {
  flattenRoomPhotos,
  getExpectedChecklistItemsFromSnapshot,
  getMissingChecklistItems,
  getMissingPhotoRequirements,
  mergeChecklistItems,
} from "@/lib/cleaner/evidence";
import { ensureIssuedChecklist } from "@/lib/services/property-checklists";
import {
  ensureEvidencePacket,
  getCleanerEvidenceFormData,
} from "@/lib/queries/cleaner-job-detail";
import {
  EVIDENCE_BUCKET,
  findMissingObjects,
  toStoragePath,
} from "@/lib/storage/signed-url";
import { and, eq } from "drizzle-orm";
import { captureAndCreatePayouts } from "@/lib/services/payment/capture-and-payout.service";

class EvidenceConflictError extends Error {}

export async function GET(
  _request: Request,
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
  const { error: assignmentError } = await requireCleanerJobAssignment(
    cleanerId,
    jobId,
  );

  if (assignmentError) {
    return NextResponse.json({ error: assignmentError }, { status: 403 });
  }

  try {
    const data = await getCleanerEvidenceFormData(cleanerId, jobId);
    if (!data) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (err) {
    console.error("[GET /api/cleaner/jobs/[id]/evidence]", err);
    return NextResponse.json(
      { error: "Failed to load evidence form" },
      { status: 500 },
    );
  }
}

export async function PATCH(
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
  const { error: assignmentError } = await requireCleanerJobAssignment(
    cleanerId,
    jobId,
  );

  if (assignmentError) {
    return NextResponse.json({ error: assignmentError }, { status: 403 });
  }

  try {
    const issuedResponse = await executionResponse(jobId, async () => {
      const body = await request.json();
      // Compatibility for installed clients: pre-departure PATCH saves a draft;
      // the established post-departure PATCH is an explicit final submission.
      const state = await getCleanerEvidenceFormData(cleanerId, jobId);
      if (!state || !("protocol" in state)) throw new Error("Issued form unavailable");
      const notes = body.cleanerNotes ?? state.cleanerNotes;
      if (body.revision === undefined && state.revision > 0) {
        const same = state.checklistItems.every(item => body.checklistLog?.items?.find((candidate: { id: string; completed: boolean }) => candidate.id === item.id)?.completed === item.completed) && notes === state.cleanerNotes;
        if (!same) throw new ExecutionError("Saved progress differs from this client. Reload using the updated app or web form before changing it.");
      }
      return saveExecutionDraft(jobId, cleanerId, { revision: body.revision ?? state.revision, items: body.checklistLog?.items, notes, explanations: body.explanations }, body.mode !== "draft" && !!state.departureRecorded);
    });
    if (issuedResponse) return issuedResponse;
    const body = evidenceInputSchema.parse(await request.json());
    const { checklistLog, cleanerNotes } = body;

    if (!checklistLog?.items?.length) {
      return NextResponse.json(
        { error: "checklistLog with items is required" },
        { status: 400 },
      );
    }

    const allChecked =
      body.mode === "draft" ||
      checklistLog.items.every((item) => item.completed);
    if (!allChecked) {
      return NextResponse.json(
        { error: "All checklist items must be checked before submitting" },
        { status: 400 },
      );
    }

    const assignment = await db.query.jobsToCleaners.findFirst({
      where: and(
        eq(jobsToCleaners.cleanerId, cleanerId),
        eq(jobsToCleaners.jobId, jobId),
      ),
      with: { job: { with: { property: { with: { checklistFiles: true } } } } },
    });

    const property = assignment?.job?.property;
    if (!property) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    if (!["primary", "laundry_lead"].includes(assignment.role))
      return NextResponse.json(
        { error: "Only the working team may submit evidence" },
        { status: 403 },
      );
    const finalized = await db.query.evidencePackets.findFirst({
      where: eq(evidencePackets.jobId, jobId),
      columns: { finalEvidenceSubmittedAt: true },
    });
    if (finalized?.finalEvidenceSubmittedAt && body.mode === "final")
      return NextResponse.json({ success: true, alreadySubmitted: true });
    const suppliedPhotos = flattenRoomPhotos(checklistLog.roomPhotos ?? {});
    if (
      new Set(suppliedPhotos).size !== suppliedPhotos.length ||
      Object.entries(checklistLog.roomPhotos ?? {}).some(([room, paths]) =>
        paths.some(
          (path) =>
            !toStoragePath(EVIDENCE_BUCKET, path).startsWith(
              `${cleanerId}/${jobId}/${room}/`,
            ),
        ),
      )
    )
      return NextResponse.json(
        {
          error:
            "Each evidence photo must be unique and belong to its recorded room",
        },
        { status: 400 },
      );

    if (
      assignment.job.status !== "in-progress" &&
      assignment.job.status !== "completed_pending_evidence"
    ) {
      return NextResponse.json(
        { error: "Evidence has already been finalized for this job." },
        { status: 409 },
      );
    }

    const snapshot = await ensureIssuedChecklist(
      jobId,
      {
        ...property,
        cleaningLevel: assignment.job.addonsSnapshot?.cleaningLevel,
      },
      property.checklistFiles,
      assignment.job.checklistSnapshot,
    );
    const requirements = snapshot.photoRequirements!;
    const expectedItems = getExpectedChecklistItemsFromSnapshot(snapshot);
    const allowedIds = new Set(expectedItems.map((item) => item.id));
    const allowedRooms = new Set(requirements.map((room) => room.roomKey));
    if (
      new Set(checklistLog.items.map((item) => item.id)).size !==
        checklistLog.items.length ||
      checklistLog.items.some((item) => !allowedIds.has(item.id)) ||
      Object.keys(checklistLog.roomPhotos ?? {}).some(
        (room) => !allowedRooms.has(room),
      )
    )
      return NextResponse.json(
        { error: "Evidence contains duplicate or unissued tasks/rooms" },
        { status: 400 },
      );
    // Issued wording/sections are authoritative; clients send completion state only.
    checklistLog.items = mergeChecklistItems(expectedItems, checklistLog.items);
    if (body.mode === "draft") {
      const roomKeys = new Set(requirements.map((r) => r.roomKey));
      if (
        Object.keys(body.explanations ?? {}).some((key) => !roomKeys.has(key))
      )
        return NextResponse.json(
          { error: "Unknown room explanation" },
          { status: 400 },
        );
      const paths = flattenRoomPhotos(checklistLog.roomPhotos ?? {});
      if (
        paths.some(
          (path) =>
            !toStoragePath(EVIDENCE_BUCKET, path).startsWith(
              `${cleanerId}/${jobId}/`,
            ),
        )
      )
        return NextResponse.json(
          { error: "Draft photos must belong to this job" },
          { status: 400 },
        );
      await db.transaction(async (tx) => {
        const [currentJob] = await tx
          .select({ status: jobs.status })
          .from(jobs)
          .where(eq(jobs.id, jobId))
          .for("update");
        const packet = await tx.query.evidencePackets.findFirst({
          where: eq(evidencePackets.jobId, jobId),
          columns: { finalEvidenceSubmittedAt: true },
        });
        if (
          !currentJob ||
          !["in-progress", "completed_pending_evidence"].includes(
            currentJob.status ?? "",
          ) ||
          packet?.finalEvidenceSubmittedAt
        )
          throw new EvidenceConflictError(
            "Draft state changed; reload evidence",
          );
        await tx
          .insert(evidenceDrafts)
          .values({
            jobId,
            cleanerId,
            explanations: body.explanations ?? {},
            state: { checklistLog, cleanerNotes: cleanerNotes ?? "" },
          })
          .onConflictDoUpdate({
            target: [evidenceDrafts.jobId, evidenceDrafts.cleanerId],
            set: {
              explanations: body.explanations ?? {},
              state: { checklistLog, cleanerNotes: cleanerNotes ?? "" },
              updatedAt: new Date(),
            },
          });
      });
      return NextResponse.json({
        success: true,
        draft: true,
        message: "Draft saved. Photo minimums still apply.",
      });
    }
    const roomPhotos = checklistLog.roomPhotos ?? {};
    const missingPhotos = getMissingPhotoRequirements(requirements, roomPhotos);

    if (missingPhotos.length > 0) {
      return NextResponse.json(
        {
          error: "Photo minimums not met",
          missing: missingPhotos,
        },
        { status: 400 },
      );
    }

    // Recompute the expected checklist server-side rather than trusting
    // whatever ids the client submitted — a property with its own uploaded
    // checklist must have every one of its items confirmed, not just any
    // single item marked complete (spec §14.2).
    const expectedChecklistItems =
      getExpectedChecklistItemsFromSnapshot(snapshot);
    const missingChecklistItems = getMissingChecklistItems(
      expectedChecklistItems,
      checklistLog.items,
    );

    if (missingChecklistItems.length > 0) {
      return NextResponse.json(
        {
          error: "Checklist incomplete",
          missing: missingChecklistItems,
        },
        { status: 400 },
      );
    }

    const photoUrls = flattenRoomPhotos(roomPhotos);

    // The photo minimums above only count strings the client sent. Nothing
    // proved those objects exist, so a tampered client could satisfy every
    // requirement with invented paths and complete a job — and be paid for it —
    // without uploading a single photo. Two checks close that:
    //
    //  1. Ownership: the upload route always returns
    //     `<cleanerId>/<jobId>/<roomKey>/<file>`, so anything outside this
    //     job's own prefix was not issued for this job (or this cleaner).
    //  2. Existence: the object must actually be in the bucket.
    const expectedPrefix = `${cleanerId}/${jobId}/`;
    const foreignPaths = photoUrls.filter(
      (path) =>
        !toStoragePath(EVIDENCE_BUCKET, path).startsWith(expectedPrefix),
    );

    if (foreignPaths.length > 0) {
      return NextResponse.json(
        {
          error: "Photo paths must come from this job's uploads",
          invalid: foreignPaths,
        },
        { status: 400 },
      );
    }

    const missingObjects = await findMissingObjects(EVIDENCE_BUCKET, photoUrls);
    if (missingObjects.length > 0) {
      return NextResponse.json(
        {
          error: "Some photos were never uploaded",
          missing: missingObjects,
        },
        { status: 400 },
      );
    }

    await ensureEvidencePacket(jobId);
    const packet = await db.query.evidencePackets.findFirst({
      where: eq(evidencePackets.jobId, jobId),
      columns: { finalEvidenceSubmittedAt: true },
    });

    // Final submission is immutable. A response retry after the server already
    // accepted it must not rewrite the audit timestamp or submit another payout.
    if (packet?.finalEvidenceSubmittedAt) {
      return NextResponse.json({ success: true, alreadySubmitted: true });
    }

    const now = new Date();
    const result = await db.transaction(async (tx) => {
      const [currentJob] = await tx
        .select({ status: jobs.status })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .for("update");
      const currentPacket = await tx.query.evidencePackets.findFirst({
        where: eq(evidencePackets.jobId, jobId),
      });
      if (currentPacket?.finalEvidenceSubmittedAt)
        return { alreadySubmitted: true, departed: false };
      if (
        !currentJob ||
        !["in-progress", "completed_pending_evidence"].includes(
          currentJob.status ?? "",
        )
      )
        throw new EvidenceConflictError("Evidence state changed; reload job");
      const departed = currentJob.status === "completed_pending_evidence";
      if (
        departed &&
        (!currentPacket?.gpsCheckInTimestamp ||
          !currentPacket.gpsCheckOutTimestamp)
      )
        throw new EvidenceConflictError(
          "Recorded check-in and departure required",
        );
      await tx
        .update(evidencePackets)
        .set({
          photoUrls,
          checklistLog,
          cleanerNotes: cleanerNotes ?? null,
          isChecklistComplete: true,
          status: departed ? "complete" : "pending_review",
          ...(departed ? { finalEvidenceSubmittedAt: now } : {}),
          updatedAt: now,
        })
        .where(eq(evidencePackets.jobId, jobId));

      if (departed) {
        await tx
          .update(jobs)
          .set({ status: "awaiting_capture", updatedAt: now })
          .where(eq(jobs.id, jobId));
      }
      return { alreadySubmitted: false, departed };
    });
    if (result.alreadySubmitted)
      return NextResponse.json({ success: true, alreadySubmitted: true });

    // Capture never runs in the mobile process. A transient Stripe failure
    // leaves the job in awaiting_capture for the authenticated server cron;
    // evidence remains final and no client-held shared key is needed.
    if (result.departed) {
      const capture = await captureAndCreatePayouts(jobId);
      return NextResponse.json({
        success: true,
        finalEvidenceSubmittedAt: now.toISOString(),
        capturePending: !capture.ok,
      });
    }

    return NextResponse.json({ success: true, pendingPhysicalCheckout: true });
  } catch (err) {
    if (err instanceof z.ZodError || err instanceof SyntaxError)
      return NextResponse.json(
        { error: "Invalid evidence submission" },
        { status: 400 },
      );
    if (err instanceof EvidenceConflictError)
      return NextResponse.json({ error: err.message }, { status: 409 });
    console.error("[PATCH /api/cleaner/jobs/[id]/evidence]", err);
    return NextResponse.json(
      { error: "Failed to submit evidence" },
      { status: 500 },
    );
  }
}
