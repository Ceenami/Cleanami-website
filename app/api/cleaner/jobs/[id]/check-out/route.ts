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
