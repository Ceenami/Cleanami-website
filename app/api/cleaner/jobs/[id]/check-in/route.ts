import { NextResponse } from "next/server";
import { db } from "@/db";
import { cleaners, evidencePackets, jobs } from "@/db/schemas";
import {
  cleanerAuthErrorStatus,
  getCleanerAuth,
  requireCleanerJobAssignment,
} from "@/lib/cleaner-auth";
import {
  getCleanerInProgressJobIds,
  getCleanerJobDetail,
} from "@/lib/queries/cleaner-job-detail";
import { eq, inArray } from "drizzle-orm";

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
    const now = new Date();
    const otherInProgressIds = await getCleanerInProgressJobIds(
      cleanerId,
      jobId
    );

    await db.transaction(async (tx) => {
      if (otherInProgressIds.length > 0) {
        await tx
          .update(jobs)
          .set({
            status: "completed_pending_evidence",
            checkOutTime: now,
            updatedAt: now,
          })
          .where(inArray(jobs.id, otherInProgressIds));

        for (const otherJobId of otherInProgressIds) {
          await tx
            .update(evidencePackets)
            .set({
              gpsCheckOutTimestamp: now,
              updatedAt: now,
            })
            .where(eq(evidencePackets.jobId, otherJobId));
        }
      }

      await tx
        .update(jobs)
        .set({
          status: "in-progress",
          checkInTime: now,
          updatedAt: now,
        })
        .where(eq(jobs.id, jobId));

      const existingPacket = await tx.query.evidencePackets.findFirst({
        where: eq(evidencePackets.jobId, jobId),
      });

      if (!existingPacket) {
        await tx.insert(evidencePackets).values({
          jobId,
          status: "incomplete",
          gpsCheckInTimestamp: now,
        });
      } else {
        await tx
          .update(evidencePackets)
          .set({
            gpsCheckInTimestamp: now,
            updatedAt: now,
          })
          .where(eq(evidencePackets.jobId, jobId));
      }

      await tx
        .update(cleaners)
        .set({ onCallStatus: "on_job", updatedAt: now })
        .where(eq(cleaners.id, cleanerId));
    });

    const job = await getCleanerJobDetail(cleanerId, jobId);
    return NextResponse.json({ success: true, job });
  } catch (err) {
    console.error("[POST /api/cleaner/jobs/[id]/check-in]", err);
    return NextResponse.json(
      { error: "Failed to check in" },
      { status: 500 }
    );
  }
}
