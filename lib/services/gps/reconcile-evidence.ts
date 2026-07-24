import "server-only";

import { db } from "@/db";
import { evidencePackets } from "@/db/schemas";
import { eq } from "drizzle-orm";
import {
  evaluateArrival,
  evaluateGeofence,
  type DeviceLocation,
} from "@/lib/services/gps/geofence";
import { notifyAdminsOfJobAlert } from "@/lib/queries/cleaner-notifications";

function toDevice(
  lat: string | null,
  lng: string | null,
  accuracy: string | null
): DeviceLocation | null {
  if (lat == null || lng == null) return null;
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) return null;
  return {
    latitude,
    longitude,
    accuracy: accuracy != null ? Number(accuracy) : null,
  };
}

type ReconcileInput = {
  job: { id: string; propertyId: string | null; checkInTime: Date | null };
  evidence: {
    checkInLatitude: string | null;
    checkInLongitude: string | null;
    checkInAccuracyMeters: string | null;
    gpsCheckInTimestamp: Date | null;
    checkOutLatitude: string | null;
    checkOutLongitude: string | null;
    checkOutAccuracyMeters: string | null;
  };
};

/**
 * Recompute an evidence packet's accountability fields (geofence flags,
 * distances, arrival delay / on-time) from its stored coordinates and
 * timestamps, and overwrite whatever the client wrote — then flag anomalies to
 * admins.
 *
 * Why: the native cleaner app writes `evidence_packets` directly, so a modified
 * client could post `arrival_on_time: true` or `check_in_within_geofence: true`
 * regardless of reality, and `arrival_delay_minutes` feeds the late-pay
 * deduction. Deriving these server-side from the stored inputs makes them
 * internally consistent and no longer independently forgeable. The coordinates
 * and check-in timestamp are themselves still client-supplied — the same trust
 * boundary the website's own check-in route already lives with — so this is
 * hardening, not proof of physical presence.
 *
 * Best-effort and self-contained: never throws. Pay is computed off a separate
 * inline arrival calculation in the capture service, so a failure here only
 * means the stored flags and the admin alert are skipped, never a bad payout.
 */
export async function reconcileEvidenceAccountability(
  input: ReconcileInput
): Promise<void> {
  const { job, evidence } = input;
  try {
    const checkInDevice = toDevice(
      evidence.checkInLatitude,
      evidence.checkInLongitude,
      evidence.checkInAccuracyMeters
    );
    const checkOutDevice = toDevice(
      evidence.checkOutLatitude,
      evidence.checkOutLongitude,
      evidence.checkOutAccuracyMeters
    );

    const [checkInGeo, checkOutGeo] = await Promise.all([
      job.propertyId
        ? evaluateGeofence(job.propertyId, checkInDevice)
        : Promise.resolve({ distanceMiles: null, withinGeofence: null }),
      job.propertyId
        ? evaluateGeofence(job.propertyId, checkOutDevice)
        : Promise.resolve({ distanceMiles: null, withinGeofence: null }),
    ]);

    const arrival = evidence.gpsCheckInTimestamp
      ? evaluateArrival(job.checkInTime, evidence.gpsCheckInTimestamp)
      : null;

    await db
      .update(evidencePackets)
      .set({
        arrivalDelayMinutes: arrival?.delayMinutes ?? null,
        arrivalOnTime: arrival?.onTime ?? null,
        checkInDistanceMiles: checkInGeo.distanceMiles?.toString() ?? null,
        checkInWithinGeofence: checkInGeo.withinGeofence,
        checkOutDistanceMiles: checkOutGeo.distanceMiles?.toString() ?? null,
        checkOutWithinGeofence: checkOutGeo.withinGeofence,
        updatedAt: new Date(),
      })
      .where(eq(evidencePackets.jobId, job.id));

    const flags: string[] = [];
    if (checkInGeo.withinGeofence === false && checkInGeo.distanceMiles != null) {
      flags.push(`checked in ${checkInGeo.distanceMiles} mi from the property`);
    }
    if (arrival && !arrival.onTime) {
      flags.push(`arrived ${arrival.delayMinutes} min late`);
    }
    if (flags.length > 0) {
      await notifyAdminsOfJobAlert({
        title: "Completed job flagged for review",
        message: flags.join("; "),
        jobId: job.id,
        outcome: "capture_flagged",
      });
    }
  } catch (error) {
    console.error("[reconcile-evidence]", error);
  }
}
