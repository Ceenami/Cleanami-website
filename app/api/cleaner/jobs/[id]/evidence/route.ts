import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { evidencePackets, jobsToCleaners } from "@/db/schemas";
import {
  cleanerAuthErrorStatus,
  getCleanerAuth,
  requireCleanerJobAssignment,
} from "@/lib/cleaner-auth";
import {
  flattenRoomPhotos,
  getExpectedChecklistItems,
  getMissingChecklistItems,
  getMissingPhotoRequirements,
  getRoomPhotoRequirements,
  type ChecklistLogPayload,
} from "@/lib/cleaner/evidence";
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

type PatchBody = {
  checklistLog: ChecklistLogPayload;
  cleanerNotes?: string;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { cleanerId, error } = await getCleanerAuth();
  if (!cleanerId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized" },
      { status: cleanerAuthErrorStatus(error) }
    );
  }

  const { id: jobId } = await params;
  const { error: assignmentError } = await requireCleanerJobAssignment(
    cleanerId,
    jobId
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
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { cleanerId, error } = await getCleanerAuth();
  if (!cleanerId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized" },
      { status: cleanerAuthErrorStatus(error) }
    );
  }

  const { id: jobId } = await params;
  const { error: assignmentError } = await requireCleanerJobAssignment(
    cleanerId,
    jobId
  );

  if (assignmentError) {
    return NextResponse.json({ error: assignmentError }, { status: 403 });
  }

  try {
    const body = (await request.json()) as PatchBody;
    const { checklistLog, cleanerNotes } = body;

    if (!checklistLog?.items?.length) {
      return NextResponse.json(
        { error: "checklistLog with items is required" },
        { status: 400 }
      );
    }

    const allChecked = checklistLog.items.every((item) => item.completed);
    if (!allChecked) {
      return NextResponse.json(
        { error: "All checklist items must be checked before submitting" },
        { status: 400 }
      );
    }

    const assignment = await db.query.jobsToCleaners.findFirst({
      where: and(
        eq(jobsToCleaners.cleanerId, cleanerId),
        eq(jobsToCleaners.jobId, jobId)
      ),
      with: { job: { with: { property: { with: { checklistFiles: true } } } } },
    });

    const property = assignment?.job?.property;
    if (!property) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const requirements = getRoomPhotoRequirements(property);
    const roomPhotos = checklistLog.roomPhotos ?? {};
    const missingPhotos = getMissingPhotoRequirements(requirements, roomPhotos);

    if (missingPhotos.length > 0) {
      return NextResponse.json(
        {
          error: "Photo minimums not met",
          missing: missingPhotos,
        },
        { status: 400 }
      );
    }

    // Recompute the expected checklist server-side rather than trusting
    // whatever ids the client submitted — a property with its own uploaded
    // checklist must have every one of its items confirmed, not just any
    // single item marked complete (spec §14.2).
    const expectedChecklistItems = getExpectedChecklistItems(
      property,
      property.checklistFiles
    );
    const missingChecklistItems = getMissingChecklistItems(
      expectedChecklistItems,
      checklistLog.items
    );

    if (missingChecklistItems.length > 0) {
      return NextResponse.json(
        {
          error: "Checklist incomplete",
          missing: missingChecklistItems,
        },
        { status: 400 }
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
      (path) => !toStoragePath(EVIDENCE_BUCKET, path).startsWith(expectedPrefix)
    );

    if (foreignPaths.length > 0) {
      return NextResponse.json(
        {
          error: "Photo paths must come from this job's uploads",
          invalid: foreignPaths,
        },
        { status: 400 }
      );
    }

    const missingObjects = await findMissingObjects(EVIDENCE_BUCKET, photoUrls);
    if (missingObjects.length > 0) {
      return NextResponse.json(
        {
          error: "Some photos were never uploaded",
          missing: missingObjects,
        },
        { status: 400 }
      );
    }

    await ensureEvidencePacket(jobId);

    await db
      .update(evidencePackets)
      .set({
        photoUrls,
        checklistLog,
        cleanerNotes: cleanerNotes ?? null,
        isChecklistComplete: true,
        status: "pending_review",
        updatedAt: new Date(),
      })
      .where(eq(evidencePackets.jobId, jobId));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[PATCH /api/cleaner/jobs/[id]/evidence]", err);
    return NextResponse.json(
      { error: "Failed to submit evidence" },
      { status: 500 }
    );
  }
}
