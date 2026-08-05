import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { evidencePackets, jobs, jobsToCleaners } from "@/db/schemas";
import {
  cleanerAuthErrorStatus,
  getCleanerAuth,
  requireCleanerJobAssignment,
} from "@/lib/cleaner-auth";
import { validateEvidenceComplete } from "@/lib/cleaner/evidence";
import { getCleanerJobDetail } from "@/lib/queries/cleaner-job-detail";
import {
  evaluateGeofence,
  recordGpsLog,
  type DeviceLocation,
} from "@/lib/services/gps/geofence";
import { and, eq } from "drizzle-orm";

/** Statuses a job can only be in once it has already been checked out of. */
const ALREADY_CHECKED_OUT_STATUSES = new Set([
  "awaiting_capture",
  "completed_pending_evidence",
  "completed",
]);

const locationSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy: z.number().nonnegative().nullable().optional(),
  })
  .nullable();

export async function POST(
  request: Request,
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

    // Idempotency: a repeat check-out (double tap, a retry after a flaky
    // response) used to succeed and overwrite `checkOutTime` and the packet's
    // GPS fields, silently rewriting when the cleaner actually left. Report
    // success without touching the recorded times.
    //
    // Only for states that come *after* a check-out — a job that was never
    // checked into still has to fail, or the app would report a clean complete
    // for work that never started.
    if (ALREADY_CHECKED_OUT_STATUSES.has(job.status ?? "")) {
      const existingJob = await getCleanerJobDetail(cleanerId, jobId);
      return NextResponse.json({
        success: true,
        alreadyCheckedOut: true,
        job: existingJob,
      });
    }

    if (job.status !== "in-progress") {
      return NextResponse.json(
        { error: "Check in before completing this job." },
        { status: 409 }
      );
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

    // Optional device location at check-out (record & flag, never block).
    let device: DeviceLocation | null = null;
    try {
      const rawBody = await request.json();
      const parsed = locationSchema.safeParse(
        rawBody?.location ?? rawBody ?? null
      );
      if (parsed.success && parsed.data) device = parsed.data;
    } catch {
      device = null;
    }

    // Recorded, never enforced — and the asymmetry with check-in is
    // deliberate, not an oversight. Check-in is gated because the clean has to
    // physically happen at the property; submission is not, because cleaners
    // are explicitly allowed to finish their paperwork from home (client
    // requirement, 2026-08). Do not "fix" this for symmetry with check-in.
    const geofence = await evaluateGeofence(property.id, device);

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
          checkOutLatitude: device ? device.latitude.toString() : null,
          checkOutLongitude: device ? device.longitude.toString() : null,
          checkOutAccuracyMeters:
            device?.accuracy != null ? device.accuracy.toString() : null,
          checkOutDistanceMiles:
            geofence.distanceMiles != null
              ? geofence.distanceMiles.toString()
              : null,
          checkOutWithinGeofence: geofence.withinGeofence,
        })
        .where(eq(evidencePackets.jobId, jobId));
    });

    if (device) {
      await recordGpsLog({
        jobId,
        cleanerId,
        device,
        activityType: "departure",
        metadata: {
          distanceMiles: geofence.distanceMiles,
          withinGeofence: geofence.withinGeofence,
        },
      });
    }

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
