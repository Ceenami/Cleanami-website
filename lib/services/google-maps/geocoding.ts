import { db } from '@/db';
import { cleaners, properties } from '@/db/schemas';
import { eq, isNull } from 'drizzle-orm';

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!;

export type Coordinates = {
  latitude: number;
  longitude: number;
};

async function geocodeAddress(address: string): Promise<Coordinates | null> {
  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
        address
      )}&key=${GOOGLE_MAPS_API_KEY}`
    );

    const data = await response.json();

    if (data.status === 'OK' && data.results.length > 0) {
      const location = data.results[0].geometry.location;
      return {
        latitude: location.lat,
        longitude: location.lng,
      };
    }

    console.warn('Geocoding failed:', data.status, address);
    return null;
  } catch (error) {
    console.error('Geocoding error:', error);
    return null;
  }
}

export async function getCleanerCoordinates(cleanerId: string): Promise<Coordinates | null> {
  const cleaner = await db.query.cleaners.findFirst({
    where: eq(cleaners.id, cleanerId),
    columns: {
      address: true,
      latitude: true,
      longitude: true,
      geocodedAt: true,
    },
  });

  if (!cleaner || !cleaner.address) return null;

  if (cleaner.latitude && cleaner.longitude) {
    return {
      latitude: parseFloat(cleaner.latitude),
      longitude: parseFloat(cleaner.longitude),
    };
  }

  const coords = await geocodeAddress(cleaner.address);
  
  if (coords) {
    await db
      .update(cleaners)
      .set({
        latitude: coords.latitude.toString(),
        longitude: coords.longitude.toString(),
        geocodedAt: new Date(),
      })
      .where(eq(cleaners.id, cleanerId));
  }

  return coords;
}

export async function getPropertyCoordinates(propertyId: string): Promise<Coordinates | null> {
  const property = await db.query.properties.findFirst({
    where: eq(properties.id, propertyId),
    columns: {
      address: true,
      latitude: true,
      longitude: true,
      geocodedAt: true,
    },
  });

  if (!property) return null;

  if (property.latitude && property.longitude) {
    return {
      latitude: parseFloat(property.latitude),
      longitude: parseFloat(property.longitude),
    };
  }

  const coords = await geocodeAddress(property.address);
  
  if (coords) {
    await db
      .update(properties)
      .set({
        latitude: coords.latitude.toString(),
        longitude: coords.longitude.toString(),
        geocodedAt: new Date(),
      })
      .where(eq(properties.id, propertyId));
  }

  return coords;
}

export async function updateCleanerCoordinates(cleanerId: string): Promise<Coordinates | null> {
  const cleaner = await db.query.cleaners.findFirst({
    where: eq(cleaners.id, cleanerId),
    columns: { address: true },
  });

  if (!cleaner || !cleaner.address) return null;

  const coords = await geocodeAddress(cleaner.address);
  
  if (coords) {
    await db
      .update(cleaners)
      .set({
        latitude: coords.latitude.toString(),
        longitude: coords.longitude.toString(),
        geocodedAt: new Date(),
      })
      .where(eq(cleaners.id, cleanerId));
  }

  return coords;
}

export async function updatePropertyCoordinates(propertyId: string): Promise<Coordinates | null> {
  const property = await db.query.properties.findFirst({
    where: eq(properties.id, propertyId),
    columns: { address: true },
  });

  if (!property) return null;

  const coords = await geocodeAddress(property.address);
  
  if (coords) {
    await db
      .update(properties)
      .set({
        latitude: coords.latitude.toString(),
        longitude: coords.longitude.toString(),
        geocodedAt: new Date(),
      })
      .where(eq(properties.id, propertyId));
  }

  return coords;
}

export function calculateDistance(
  coord1: Coordinates,
  coord2: Coordinates
): number {
  const R = 3959;
  const dLat = toRad(coord2.latitude - coord1.latitude);
  const dLon = toRad(coord2.longitude - coord1.longitude);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(coord1.latitude)) *
      Math.cos(toRad(coord2.latitude)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export async function geocodeAllCleaners(
  onProgress?: (current: number, total: number) => void
): Promise<void> {
  const cleanersToGeocode = await db.query.cleaners.findMany({
    where: isNull(cleaners.latitude),

    columns: {
      id: true,
      address: true,
    },
  });

  for (let i = 0; i < cleanersToGeocode.length; i++) {
    const cleaner = cleanersToGeocode[i];
    if (cleaner.address) {
      await updateCleanerCoordinates(cleaner.id);
    }
    
    if (onProgress) {
      onProgress(i + 1, cleanersToGeocode.length);
    }
    
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

export async function geocodeAllProperties(
  onProgress?: (current: number, total: number) => void
): Promise<void> {
  const propertiesToGeocode = await db.query.properties.findMany({
    where: isNull(properties.latitude),
    columns: {
      id: true,
      address: true,
    },
  });

  for (let i = 0; i < propertiesToGeocode.length; i++) {
    const property = propertiesToGeocode[i];
    await updatePropertyCoordinates(property.id);
    
    if (onProgress) {
      onProgress(i + 1, propertiesToGeocode.length);
    }
    
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}