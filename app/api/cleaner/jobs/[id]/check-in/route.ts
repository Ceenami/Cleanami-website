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
  GEOFENCE_RADIUS_MILES,
  ON_TIME_GRACE_MINUTES,
  type DeviceLocation,
  type GeofenceResult,
} from "@/lib/services/gps/geofence";
import { recordArrivalEvent } from "@/lib/services/reliability/reliability.service";
import {
  evaluateCheckInWindow,
  formatWindowTimeEt,
} from "@/lib/cleaner/check-in-window";
import { notifyAdminsOfJobAlert } from "@/lib/queries/cleaner-notifications";
import { eq, inArray } from "drizzle-orm";

const locationSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy: z.number().nonnegative().nullable().optional(),
  })
  .nullable();

/**
 * Justification for checking in when the geofence gate would otherwise refuse.
 * A minimum length is enforced so the field cannot be satisfied with "." — an
 * override is reviewed by an admin and has to say something.
 */
const overrideSchema = z.object({
  reason: z.string().trim().min(10).max(500),
});

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

  // The body carries the device fix and, when the cleaner is retrying a
  // refused check-in, their justification. Read once — `request.json()` can
  // only be consumed a single time.
  let device: DeviceLocation | null = null;
  let overrideReason: string | null = null;
  try {
    const rawBody = await request.json();
    const parsed = locationSchema.safeParse(rawBody?.location ?? rawBody ?? null);
    if (parsed.success && parsed.data) device = parsed.data;

    const parsedOverride = overrideSchema.safeParse(rawBody?.override);
    if (parsedOverride.success) overrideReason = parsedOverride.data.reason;
  } catch {
    device = null;
  }

  try {
    const now = new Date();

    // `jobs.checkInTime` is the SCHEDULED start (the guest checkout anchor set
    // when the job was created). It is a planned value and is never overwritten
    // with the actual arrival — the arrival lives on the evidence packet as
    // `gpsCheckInTimestamp`. Clobbering it would destroy the reference that the
    // spec's on-time definition ("no more than 10 minutes late beyond the
    // assigned start time"), reconciliation and the window check below rely on.
    const jobBefore = await db.query.jobs.findFirst({
      where: eq(jobs.id, jobId),
      columns: { propertyId: true, checkInTime: true, status: true },
      with: {
        property: { columns: { defaultCheckOutTime: true } },
      },
    });
    const scheduledCheckIn = jobBefore?.checkInTime ?? null;
    const propertyId = jobBefore?.propertyId ?? null;
    // Idempotency: a repeat check-in on an already in-progress job must not
    // insert a second arrival reliability event (which would skew the score)
    // or re-flag the arrival to admins.
    const alreadyCheckedIn = jobBefore?.status === "in-progress";

    // 1.17 — restrict check-in to the allowed cleaning window. Before the guest
    // checks out the property is still occupied and the clean cannot start, so
    // an early check-in is refused. Late check-in is NOT blocked (see
    // `evaluateCheckInWindow`). Skipped for an already in-progress job so a
    // repeat call stays idempotent.
    const checkInWindow = evaluateCheckInWindow({
      scheduledCheckIn,
      propertyCheckOutTime: jobBefore?.property?.defaultCheckOutTime,
      now,
    });
    if (checkInWindow?.isEarly && !alreadyCheckedIn) {
      return NextResponse.json(
        {
          error: `Check-in opens at ${formatWindowTimeEt(
            checkInWindow.opensAt
          )}, when the guest checks out.`,
          code: "check_in_window_not_open",
          opensAt: checkInWindow.opensAt.toISOString(),
          minutesEarly: checkInWindow.minutesEarly,
        },
        { status: 409 }
      );
    }

    const geofence: GeofenceResult = propertyId
      ? await evaluateGeofence(propertyId, device)
      : {
          distanceMiles: null,
          withinGeofence: null,
          verdict: "unknown",
          reason: "property_not_geocoded",
          accuracyMiles: null,
          radiusMiles: GEOFENCE_RADIUS_MILES,
        };

    // Geofence gate (client requirement: check-in must happen at the property).
    //
    // Only two outcomes refuse: the device is CONFIDENTLY outside the fence, or
    // there is no fix at all so nothing can be verified. A fix too coarse to
    // decide, and a property we never geocoded, are our problem rather than the
    // cleaner's — those pass and are flagged for review instead.
    //
    // Skipped entirely once the job is in-progress. A repeat check-in (double
    // tap, retry after a flaky response, reopening the workflow screen) has to
    // stay idempotent, and by then the cleaner may legitimately have moved.
    const blockedReason =
      geofence.verdict === "outside"
        ? "outside_geofence"
        : geofence.reason === "no_device_location"
        ? "location_required"
        : null;

    // An override is only meaningful against a refusal on a first check-in.
    // Accepting one on a clean check-in would litter the review queue with
    // justifications for check-ins that were never in question, and accepting
    // one on a repeat call would let a later request overwrite the record of
    // how the cleaner originally got in.
    const overrideApplied =
      blockedReason !== null && overrideReason !== null && !alreadyCheckedIn;

    if (blockedReason && !overrideApplied && !alreadyCheckedIn) {
      return NextResponse.json(
        blockedReason === "outside_geofence"
          ? {
              error: `You appear to be ${geofence.distanceMiles} mi from the property. Check in once you have arrived — or tell us why you're checking in from here.`,
              code: "outside_geofence",
              distanceMiles: geofence.distanceMiles,
              // The radius this refusal was actually measured against — the
              // property's own override when it has one, not the global
              // default. The app shows it, so it has to be the real one.
              radiusMiles: geofence.radiusMiles,
              canOverride: true,
            }
          : {
              error:
                "Location is required to check in. Turn on location access for CleanNami, then try again — or tell us why you can't.",
              code: "location_required",
              canOverride: true,
            },
        { status: 409 }
      );
    }

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

      // `checkInTime` is intentionally left alone — see the note above.
      await tx
        .update(jobs)
        .set({
          status: "in-progress",
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
        // Written only on an override, so a plain check-in never clears or
        // overwrites a reason recorded earlier.
        ...(overrideApplied
          ? {
              checkInOverrideReason: overrideReason,
              checkInOverrideAt: now,
            }
          : {}),
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
    // Only on the first check-in: re-entering the workflow screen on a job
    // already in progress used to write another 'arrival' point, so the arrival
    // rows were not a reliable count of actual arrivals.
    if (device && !alreadyCheckedIn) {
      await recordGpsLog({
        jobId,
        cleanerId,
        device,
        activityType: "arrival",
        metadata: {
          distanceMiles: geofence.distanceMiles,
          withinGeofence: geofence.withinGeofence,
          geofenceVerdict: geofence.verdict,
          geofenceReason: geofence.reason,
          ...(overrideApplied ? { overrideReason } : {}),
        },
      });
    }

    // Record arrival reliability event (feeds the reliability score + late pay).
    // Only on the first check-in — never duplicate on a repeat.
    if (arrival && !alreadyCheckedIn) {
      await recordArrivalEvent({
        cleanerId,
        jobId,
        delayMinutes: arrival.delayMinutes,
        graceMinutes: ON_TIME_GRACE_MINUTES,
      });
    }

    // Flag anomalies for admin review. An override is the important one — it
    // is the only path by which a check-in the gate refused still went ahead,
    // so it must never happen quietly.
    const flags: string[] = [];
    if (overrideApplied) {
      flags.push(
        geofence.verdict === "outside" && geofence.distanceMiles != null
          ? `OVERRODE the geofence from ${geofence.distanceMiles} mi away — reason: "${overrideReason}"`
          : `OVERRODE the location requirement with no device fix — reason: "${overrideReason}"`
      );
    } else if (
      geofence.withinGeofence === false &&
      geofence.distanceMiles != null
    ) {
      flags.push(`checked in ${geofence.distanceMiles} mi from the property`);
    } else if (geofence.reason === "low_accuracy") {
      flags.push(
        "location could not be verified — the device fix was too imprecise to place it at the property"
      );
    } else if (geofence.reason === "property_not_geocoded") {
      flags.push(
        "location could not be verified — this property has no coordinates on file"
      );
    }
    if (arrival && !arrival.onTime) {
      flags.push(`arrived ${arrival.delayMinutes} min late`);
    }
    if (flags.length > 0 && !alreadyCheckedIn) {
      await notifyAdminsOfJobAlert({
        title: overrideApplied
          ? "Check-in geofence OVERRIDDEN"
          : "Check-in flagged for review",
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
