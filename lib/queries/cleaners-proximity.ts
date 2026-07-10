import { db } from '@/db';
import { cleaners } from '@/db/schemas';
import { isCleanerAssignmentEligible } from '@/lib/cleaner/eligibility';
import { isNotNull, and } from 'drizzle-orm';
import { calculateDistance, getPropertyCoordinates } from '@/lib/services/google-maps/geocoding';

const DEFAULT_SERVICE_RADIUS_MILES = 25;

export type AvailableCleanerWithDistance = {
  id: string;
  fullName: string;
  reliabilityScore: string | null;
  onCallStatus: 'available' | 'unavailable' | 'on_job';
  /** Miles from property; null when address is not geocoded. */
  distance: number | null;
};

type CleanerProximityOptions = {
  /** Omit or set for default 25 mi; pass `null` for admin override (no distance cap). */
  radiusMiles?: number | null;
  includeOnJob?: boolean;
  /** When true, include eligible cleaners without geocoded coordinates. */
  includeUngeocoded?: boolean;
};

export async function getAvailableCleanersForProperty(
  propertyId: string,
  options?: CleanerProximityOptions
): Promise<AvailableCleanerWithDistance[]> {
  const radiusMiles = options?.radiusMiles ?? DEFAULT_SERVICE_RADIUS_MILES;
  const includeOnJob = options?.includeOnJob ?? true;
  const includeUngeocoded = options?.includeUngeocoded ?? false;
  const unlimitedRadius = radiusMiles === null;

  const propertyCoords = await getPropertyCoordinates(propertyId);

  if (!propertyCoords && !unlimitedRadius) {
    throw new Error('Could not geocode property address');
  }

  const allCleaners = await db.query.cleaners.findMany({
    where: includeUngeocoded || unlimitedRadius
      ? isNotNull(cleaners.onCallStatus)
      : and(
          isNotNull(cleaners.latitude),
          isNotNull(cleaners.longitude),
          isNotNull(cleaners.onCallStatus)
        ),
    columns: {
      id: true,
      fullName: true,
      latitude: true,
      longitude: true,
      reliabilityScore: true,
      onCallStatus: true,
      accountStatus: true,
      onboardingCompleted: true,
      onboardingStarted: true,
      stripePayoutsEnabled: true,
      stripeChargesEnabled: true,
      stripeOnboardingComplete: true,
      eligibleForAssignments: true,
      legalDocsSigned: true,
    },
  });

  const eligibleCleaners = allCleaners.filter((cleaner) =>
    isCleanerAssignmentEligible(cleaner)
  );

  const availableCleaners = eligibleCleaners
    .map((cleaner) => {
      let distance: number | null = null;

      if (
        propertyCoords &&
        cleaner.latitude &&
        cleaner.longitude
      ) {
        distance = calculateDistance(propertyCoords, {
          latitude: parseFloat(cleaner.latitude),
          longitude: parseFloat(cleaner.longitude),
        });
        distance = Math.round(distance * 10) / 10;
      }

      return {
        id: cleaner.id,
        fullName: cleaner.fullName,
        reliabilityScore: cleaner.reliabilityScore,
        onCallStatus: cleaner.onCallStatus!,
        distance,
      };
    })
    .filter((c) => {
      if (
        !unlimitedRadius &&
        radiusMiles !== undefined &&
        c.distance !== null &&
        c.distance > radiusMiles
      ) {
        return false;
      }

      if (!includeOnJob && c.onCallStatus === 'on_job') return false;

      return true;
    })
    .sort((a, b) => {
      const scoreA = parseFloat(a.reliabilityScore || '0');
      const scoreB = parseFloat(b.reliabilityScore || '0');
      if (scoreB !== scoreA) return scoreB - scoreA;
      if (a.distance === null && b.distance === null) return 0;
      if (a.distance === null) return 1;
      if (b.distance === null) return -1;
      return a.distance - b.distance;
    });

  return availableCleaners;
}

/** All assignment-eligible cleaners for admin override (no radius cap). */
export async function getAllEligibleCleanersForJob(
  jobId: string,
  options?: { includeOnJob?: boolean }
): Promise<{
  cleaners: AvailableCleanerWithDistance[];
  propertyId: string;
  propertyAddress: string;
}> {
  return getAvailableCleanersForJob(jobId, {
    radiusMiles: null,
    includeUngeocoded: true,
    includeOnJob: options?.includeOnJob ?? true,
  });
}

export async function getAvailableCleanersForJob(
  jobId: string,
  options?: CleanerProximityOptions
): Promise<{
  cleaners: AvailableCleanerWithDistance[];
  propertyId: string;
  propertyAddress: string;
}> {
  const { jobs } = await import('@/db/schemas');
  const { eq } = await import('drizzle-orm');

  const job = await db.query.jobs.findFirst({
    where: eq(jobs.id, jobId),
    with: {
      property: {
        columns: {
          id: true,
          address: true,
        },
      },
    },
  });

  if (!job || !job.property) {
    throw new Error('Job or property not found');
  }

  const cleaners = await getAvailableCleanersForProperty(job.property.id, options);

  return {
    cleaners,
    propertyId: job.property.id,
    propertyAddress: job.property.address,
  };
}

export async function getClosestCleanerForProperty(
  propertyId: string,
  options?: {
    radiusMiles?: number;
  }
): Promise<AvailableCleanerWithDistance | null> {
  const cleaners = await getAvailableCleanersForProperty(propertyId, {
    ...options,
    includeOnJob: false,
  });

  return cleaners[0] || null;
}