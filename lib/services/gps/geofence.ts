import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { gpsTrackingLogs, properties } from "@/db/schemas";
import {
  MAX_GEOFENCE_RADIUS_METERS,
  MIN_GEOFENCE_RADIUS_METERS,
} from "@/lib/constants/geofence";
import {
  calculateDistance,
  getPropertyCoordinates,
  type Coordinates,
} from "@/lib/services/google-maps/geocoding";

/**
 * Default geofence radius around a property (miles), used when the property has
 * no explicit `geofenceRadiusMeters`. Browser GPS is imprecise, so this is
 * intentionally generous.
 *
 * Two separate things are derived from the effective radius, and they must not
 * be confused:
 *   - `withinGeofence` — the plain `distance <= radius` fact, recorded on the
 *     evidence packet and used to flag a check-in for admin review. Unchanged
 *     semantics; historical rows stay comparable.
 *   - `verdict` — the accuracy-aware decision used to BLOCK a check-in. A
 *     check-in is only refused when the device is confidently outside, so a
 *     poor fix never strands a cleaner who is actually standing at the door.
 */
export const GEOFENCE_RADIUS_MILES = 0.3;

const METERS_PER_MILE = 1609.344;

/** The default expressed in metres, for admin UI copy and API responses. */
export const DEFAULT_GEOFENCE_RADIUS_METERS = Math.round(
  GEOFENCE_RADIUS_MILES * METERS_PER_MILE
);

/**
 * Turn a stored `geofence_radius_meters` into the radius in miles actually used
 * for a decision.
 *
 * Clamped rather than rejected. The CHECK constraint already keeps new writes in
 * range, so an out-of-range value here means legacy or hand-edited data — and
 * for a safety control, silently widening the fence to whatever a bad row says
 * is the one outcome to avoid. Non-finite and non-positive values fall back to
 * the default for the same reason.
 */
export function resolveGeofenceRadiusMiles(
  geofenceRadiusMeters: number | null | undefined
): number {
  if (
    geofenceRadiusMeters == null ||
    !Number.isFinite(geofenceRadiusMeters) ||
    geofenceRadiusMeters <= 0
  ) {
    return GEOFENCE_RADIUS_MILES;
  }
  const clamped = Math.min(
    MAX_GEOFENCE_RADIUS_METERS,
    Math.max(MIN_GEOFENCE_RADIUS_METERS, geofenceRadiusMeters)
  );
  return clamped / METERS_PER_MILE;
}

/**
 * The effective radius in miles for one property.
 *
 * A missing property yields the default rather than throwing: the caller is
 * about to evaluate a geofence and "property row vanished" must not be a way to
 * get a wider fence than normal.
 */
export async function getPropertyGeofenceRadiusMiles(
  propertyId: string
): Promise<number> {
  try {
    const row = await db.query.properties.findFirst({
      where: eq(properties.id, propertyId),
      columns: { geofenceRadiusMeters: true },
    });
    return resolveGeofenceRadiusMiles(row?.geofenceRadiusMeters);
  } catch {
    return GEOFENCE_RADIUS_MILES;
  }
}

/** Arrivals within this many minutes of the scheduled window count as on-time. */
export const ON_TIME_GRACE_MINUTES = 10;

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
  /**
   * The radius this decision was actually made against, in miles — the
   * property's override or the system default. Returned so the caller can tell
   * the cleaner what fence they missed, and so the audit trail records the rule
   * as it stood at the time rather than as it stands today.
   */
  radiusMiles: number;
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
  accuracyMiles: number,
  radiusMiles: number
): { verdict: GeofenceVerdict; reason: GeofenceReason } {
  // Confidently outside: even the nearest point the device could actually be
  // at is beyond the fence.
  if (distanceMiles - accuracyMiles > radiusMiles) {
    return { verdict: "outside", reason: "beyond_radius" };
  }

  // The error circle is wider than the fence itself, so "inside" cannot be
  // asserted either. Typical of an indoor Wi-Fi fix, and of iOS 14+ with
  // Precise Location off (which returns a fix fuzzed by kilometres).
  //
  // Note this gets *rarer* as the radius widens: a property on the 1000 m
  // ceiling only reaches `unknown` on a fix worse than ±1 km, so raising a
  // radius tightens this free pass rather than loosening it.
  if (accuracyMiles >= radiusMiles) {
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
 *
 * `radiusMilesOverride` lets a caller that already resolved the property's
 * radius reuse it instead of re-querying. Reconciliation evaluates check-in and
 * check-out for the same property back to back and is the reason it exists.
 */
export async function evaluateGeofence(
  propertyId: string,
  device: DeviceLocation | null,
  radiusMilesOverride?: number
): Promise<GeofenceResult> {
  if (!device) {
    return {
      distanceMiles: null,
      withinGeofence: null,
      verdict: "unknown",
      reason: "no_device_location",
      accuracyMiles: null,
      radiusMiles: radiusMilesOverride ?? GEOFENCE_RADIUS_MILES,
    };
  }

  // Sequential, never Promise.all: the transaction pooler drops all but the
  // first query of a pipelined batch and the remaining promises never settle.
  const radiusMiles =
    radiusMilesOverride ?? (await getPropertyGeofenceRadiusMiles(propertyId));

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
      radiusMiles,
    };
  }

  const distance = calculateDistance(propertyCoords, {
    latitude: device.latitude,
    longitude: device.longitude,
  });
  const rounded = Math.round(distance * 1000) / 1000;
  const { verdict, reason } = classify(rounded, accuracyMiles, radiusMiles);

  return {
    distanceMiles: rounded,
    withinGeofence: rounded <= radiusMiles,
    verdict,
    reason,
    accuracyMiles,
    radiusMiles,
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
