import { NextResponse } from "next/server";
import { db } from "@/db";
import { evidencePackets, jobs, jobsToCleaners } from "@/db/schemas";
import {
  cleanerAuthErrorStatus,
  getCleanerAuth,
  requireCleanerJobAssignment,
} from "@/lib/cleaner-auth";
import { validateEvidenceComplete } from "@/lib/cleaner/evidence";
import { getCleanerJobDetail } from "@/lib/queries/cleaner-job-detail";
import { and, eq } from "drizzle-orm";

export async function POST(
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
    const assignment = await db.query.jobsToCleaners.findFirst({
      where: and(
        eq(jobsToCleaners.cleanerId, cleanerId),
        eq(jobsToCleaners.jobId, jobId)
      ),
      with: {
        job: {
          with: {
            property: true,
            evidencePacket: true,
          },
        },
      },
    });

    const job = assignment?.job;
    const evidence = job?.evidencePacket;
    const property = job?.property;

    if (!job || !property) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (!evidence) {
      return NextResponse.json(
        {
          error: "Evidence packet incomplete",
          missing: ["Evidence packet not started"],
        },
        { status: 400 }
      );
    }

    const validation = validateEvidenceComplete(evidence, property);
    if (!validation.valid) {
      return NextResponse.json(
        {
          error: "Evidence packet incomplete",
          missing: validation.missing,
        },
        { status: 400 }
      );
    }

    const now = new Date();

    await db.transaction(async (tx) => {
      await tx
        .update(jobs)
        .set({
          status: "awaiting_capture",
          checkOutTime: now,
          updatedAt: now,
        })
        .where(eq(jobs.id, jobId));

      await tx
        .update(evidencePackets)
        .set({
          gpsCheckOutTimestamp: now,
          status: "complete",
          updatedAt: now,
        })
        .where(eq(evidencePackets.jobId, jobId));
    });

    const updatedJob = await getCleanerJobDetail(cleanerId, jobId);
    return NextResponse.json({ success: true, job: updatedJob });
  } catch (err) {
    console.error("[POST /api/cleaner/jobs/[id]/check-out]", err);
    return NextResponse.json(
      { error: "Failed to check out" },
      { status: 500 }
    );
  }
}
