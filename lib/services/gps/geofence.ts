import "server-only";

import { db } from "@/db";
import { gpsTrackingLogs } from "@/db/schemas";
import {
  calculateDistance,
  getPropertyCoordinates,
  type Coordinates,
} from "@/lib/services/google-maps/geocoding";

/**
 * Geofence radius around the property (miles). Browser GPS is imprecise, so
 * this is intentionally generous.
 *
 * Two separate things are derived from this radius, and they must not be
 * confused:
 *   - `withinGeofence` — the plain `distance <= radius` fact, recorded on the
 *     evidence packet and used to flag a check-in for admin review. Unchanged
 *     semantics; historical rows stay comparable.
 *   - `verdict` — the accuracy-aware decision used to BLOCK a check-in. A
 *     check-in is only refused when the device is confidently outside, so a
 *     poor fix never strands a cleaner who is actually standing at the door.
 */
export const GEOFENCE_RADIUS_MILES = 0.3;

/** Arrivals within this many minutes of the scheduled window count as on-time. */
export const ON_TIME_GRACE_MINUTES = 10;

const METERS_PER_MILE = 1609.344;

export type DeviceLocation = {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
};

/**
 * Blocking decision for a location fix.
 *
 * `unknown` is deliberately distinct from `outside`: "we could not tell" must
 * never be punished like "you are somewhere else". Property not geocoded, no
 * device fix, and a fix too coarse to place inside the circle all land here,
 * and all of them are allowed through and flagged.
 */
export type GeofenceVerdict = "inside" | "outside" | "unknown";

/** Why the verdict came out the way it did — recorded for the audit trail. */
export type GeofenceReason =
  | "within_radius"
  | "beyond_radius"
  | "no_device_location"
  | "property_not_geocoded"
  | "low_accuracy";

export type GeofenceResult = {
  distanceMiles: number | null;
  /** Plain `distance <= radius`. Null when it could not be computed. */
  withinGeofence: boolean | null;
  verdict: GeofenceVerdict;
  reason: GeofenceReason;
  /** Device-reported accuracy in miles, when the device supplied one. */
  accuracyMiles: number | null;
};

/**
 * Decide a verdict from a distance and the fix's own error radius.
 *
 * Order matters. "Confidently outside" is tested BEFORE the low-accuracy
 * bail-out, so a client cannot buy itself an `unknown` — and the free pass
 * that comes with it — merely by reporting a huge `accuracy`. A fix claiming
 * ±20 km still resolves to `outside` once the measured distance exceeds the
 * radius by more than that 20 km.
 */
function classify(
  distanceMiles: number,
  accuracyMiles: number
): { verdict: GeofenceVerdict; reason: GeofenceReason } {
  // Confidently outside: even the nearest point the device could actually be
  // at is beyond the fence.
  if (distanceMiles - accuracyMiles > GEOFENCE_RADIUS_MILES) {
    return { verdict: "outside", reason: "beyond_radius" };
  }

  // The error circle is wider than the fence itself, so "inside" cannot be
  // asserted either. Typical of an indoor Wi-Fi fix, and of iOS 14+ with
  // Precise Location off (which returns a fix fuzzed by kilometres).
  if (accuracyMiles >= GEOFENCE_RADIUS_MILES) {
    return { verdict: "unknown", reason: "low_accuracy" };
  }

  // Either comfortably inside, or the circles overlap. Overlap is not proof of
  // being outside, so it is not treated as such.
  return { verdict: "inside", reason: "within_radius" };
}

/**
 * Compare a device location to the property.
 *
 * `distanceMiles`/`withinGeofence` stay null when either side is unavailable —
 * "we could not decide" is distinct from "out of range", and the DB columns
 * are nullable for exactly that reason.
 */
export async function evaluateGeofence(
  propertyId: string,
  device: DeviceLocation | null
): Promise<GeofenceResult> {
  if (!device) {
    return {
      distanceMiles: null,
      withinGeofence: null,
      verdict: "unknown",
      reason: "no_device_location",
      accuracyMiles: null,
    };
  }

  // A device that reports no accuracy is treated as an exact fix (0 miles of
  // error). That is the strict reading, and it is the safe one here: assuming
  // a generous error instead would hand every client a way to opt out of the
  // check by simply omitting the field.
  const accuracyMiles =
    device.accuracy != null && Number.isFinite(device.accuracy)
      ? Math.max(0, device.accuracy) / METERS_PER_MILE
      : 0;

  let propertyCoords: Coordinates | null = null;
  try {
    propertyCoords = await getPropertyCoordinates(propertyId);
  } catch {
    propertyCoords = null;
  }
  if (!propertyCoords) {
    return {
      distanceMiles: null,
      withinGeofence: null,
      verdict: "unknown",
      reason: "property_not_geocoded",
      accuracyMiles,
    };
  }

  const distance = calculateDistance(propertyCoords, {
    latitude: device.latitude,
    longitude: device.longitude,
  });
  const rounded = Math.round(distance * 1000) / 1000;
  const { verdict, reason } = classify(rounded, accuracyMiles);

  return {
    distanceMiles: rounded,
    withinGeofence: rounded <= GEOFENCE_RADIUS_MILES,
    verdict,
    reason,
    accuracyMiles,
  };
}

export type ArrivalResult = {
  delayMinutes: number;
  onTime: boolean;
};

/**
 * Minutes late (negative = early) relative to the scheduled arrival, and
 * whether that is within the on-time grace window.
 */
export function evaluateArrival(
  scheduledCheckIn: Date | null,
  actualCheckIn: Date
): ArrivalResult | null {
  if (!scheduledCheckIn) return null;
  const delayMs = actualCheckIn.getTime() - scheduledCheckIn.getTime();
  const delayMinutes = Math.round(delayMs / 60000);
  return {
    delayMinutes,
    onTime: delayMinutes <= ON_TIME_GRACE_MINUTES,
  };
}

/** Persist a raw GPS point (previously dead storage) for the audit trail. */
export async function recordGpsLog(input: {
  jobId: string;
  cleanerId: string;
  device: DeviceLocation;
  activityType: "arrival" | "working" | "departure";
  metadata?: Record<string, unknown>;
  /**
   * When the fix was actually taken, if that is not "now". The app's background
   * runner captures points while the device is asleep and can only upload them
   * once the app next wakes, so the arrival time of the request says nothing
   * about when the cleaner was at that position. Recorded as `createdAt` so the
   * trail reads chronologically, and flagged in metadata so a late-arriving row
   * is distinguishable from a live one.
   */
  capturedAt?: Date;
}): Promise<void> {
  await db.insert(gpsTrackingLogs).values({
    jobId: input.jobId,
    cleanerId: input.cleanerId,
    latitude: input.device.latitude.toString(),
    longitude: input.device.longitude.toString(),
    accuracy:
      input.device.accuracy != null ? input.device.accuracy.toString() : null,
    activityType: input.activityType,
    metadata: input.capturedAt
      ? { ...(input.metadata ?? {}), backfilled: true }
      : input.metadata ?? {},
    ...(input.capturedAt ? { createdAt: input.capturedAt } : {}),
  });
}
