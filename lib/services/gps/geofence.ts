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
 * this is intentionally generous — out-of-range check-ins are FLAGGED for
 * admin review, never blocked (product decision).
 */
export const GEOFENCE_RADIUS_MILES = 0.3;

/** Arrivals within this many minutes of the scheduled window count as on-time. */
export const ON_TIME_GRACE_MINUTES = 10;

export type DeviceLocation = {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
};

export type GeofenceResult = {
  distanceMiles: number | null;
  withinGeofence: boolean | null;
};

/**
 * Compare a device location to the property. Returns nulls when either the
 * device location or the property coordinates are unavailable (can't decide).
 */
export async function evaluateGeofence(
  propertyId: string,
  device: DeviceLocation | null
): Promise<GeofenceResult> {
  if (!device) return { distanceMiles: null, withinGeofence: null };

  let propertyCoords: Coordinates | null = null;
  try {
    propertyCoords = await getPropertyCoordinates(propertyId);
  } catch {
    propertyCoords = null;
  }
  if (!propertyCoords) return { distanceMiles: null, withinGeofence: null };

  const distance = calculateDistance(propertyCoords, {
    latitude: device.latitude,
    longitude: device.longitude,
  });
  const rounded = Math.round(distance * 1000) / 1000;
  return {
    distanceMiles: rounded,
    withinGeofence: rounded <= GEOFENCE_RADIUS_MILES,
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
}): Promise<void> {
  await db.insert(gpsTrackingLogs).values({
    jobId: input.jobId,
    cleanerId: input.cleanerId,
    latitude: input.device.latitude.toString(),
    longitude: input.device.longitude.toString(),
    accuracy:
      input.device.accuracy != null ? input.device.accuracy.toString() : null,
    activityType: input.activityType,
    metadata: input.metadata ?? {},
  });
}
