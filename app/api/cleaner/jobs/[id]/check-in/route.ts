import { NextResponse } from "next/server";
import { z } from "zod";
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
import {
  evaluateArrival,
  evaluateGeofence,
  recordGpsLog,
  ON_TIME_GRACE_MINUTES,
  type DeviceLocation,
} from "@/lib/services/gps/geofence";
import { recordArrivalEvent } from "@/lib/services/reliability/reliability.service";
import { notifyAdminsOfJobAlert } from "@/lib/queries/cleaner-notifications";
import { eq, inArray } from "drizzle-orm";

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

  // Device location is optional (the cleaner may deny permission). If sent, we
  // record + flag it but never block the check-in.
  let device: DeviceLocation | null = null;
  try {
    const rawBody = await request.json();
    const parsed = locationSchema.safeParse(rawBody?.location ?? rawBody ?? null);
    if (parsed.success && parsed.data) device = parsed.data;
  } catch {
    device = null;
  }

  try {
    const now = new Date();

    // Read the SCHEDULED check-in time before we overwrite it with `now`.
    const jobBefore = await db.query.jobs.findFirst({
      where: eq(jobs.id, jobId),
      columns: { propertyId: true, checkInTime: true },
    });
    const scheduledCheckIn = jobBefore?.checkInTime ?? null;
    const propertyId = jobBefore?.propertyId ?? null;

    const geofence = propertyId
      ? await evaluateGeofence(propertyId, device)
      : { distanceMiles: null, withinGeofence: null };
    const arrival = evaluateArrival(scheduledCheckIn, now);

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

      const gpsFields = {
        checkInLatitude: device ? device.latitude.toString() : null,
        checkInLongitude: device ? device.longitude.toString() : null,
        checkInAccuracyMeters:
          device?.accuracy != null ? device.accuracy.toString() : null,
        checkInDistanceMiles:
          geofence.distanceMiles != null
            ? geofence.distanceMiles.toString()
            : null,
        checkInWithinGeofence: geofence.withinGeofence,
        arrivalDelayMinutes: arrival?.delayMinutes ?? null,
        arrivalOnTime: arrival?.onTime ?? null,
      };

      const existingPacket = await tx.query.evidencePackets.findFirst({
        where: eq(evidencePackets.jobId, jobId),
      });

      if (!existingPacket) {
        await tx.insert(evidencePackets).values({
          jobId,
          status: "incomplete",
          gpsCheckInTimestamp: now,
          ...gpsFields,
        });
      } else {
        await tx
          .update(evidencePackets)
          .set({
            gpsCheckInTimestamp: now,
            updatedAt: now,
            ...gpsFields,
          })
          .where(eq(evidencePackets.jobId, jobId));
      }

      await tx
        .update(cleaners)
        .set({ onCallStatus: "on_job", updatedAt: now })
        .where(eq(cleaners.id, cleanerId));
    });

    // Audit trail + accountability (record & flag; never blocks check-in).
    if (device) {
      await recordGpsLog({
        jobId,
        cleanerId,
        device,
        activityType: "arrival",
        metadata: {
          distanceMiles: geofence.distanceMiles,
          withinGeofence: geofence.withinGeofence,
        },
      });
    }

    // Record arrival reliability event (feeds the reliability score + late pay).
    if (arrival) {
      await recordArrivalEvent({
        cleanerId,
        jobId,
        delayMinutes: arrival.delayMinutes,
        graceMinutes: ON_TIME_GRACE_MINUTES,
      });
    }

    // Flag anomalies for admin review (out of geofence, or late arrival).
    const flags: string[] = [];
    if (geofence.withinGeofence === false && geofence.distanceMiles != null) {
      flags.push(`checked in ${geofence.distanceMiles} mi from the property`);
    }
    if (arrival && !arrival.onTime) {
      flags.push(`arrived ${arrival.delayMinutes} min late`);
    }
    if (flags.length > 0) {
      await notifyAdminsOfJobAlert({
        title: "Check-in flagged for review",
        message: flags.join("; "),
        jobId,
        outcome: "check_in_flagged",
      });
    }

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
