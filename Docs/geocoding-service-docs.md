# Geocoding Service Documentation

## Overview

The geocoding service provides utilities for converting addresses to geographic coordinates (latitude/longitude) using Google Maps Geocoding API, calculating distances between locations, and managing cached coordinates for cleaners and properties in the database.

## Configuration

### Environment Variables
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` - Google Maps API key (required)

---

## Type Definitions

### `Coordinates`
```typescript
{
  latitude: number;
  longitude: number;
}
```

---

## Core Functions

### `geocodeAddress(address: string): Promise<Coordinates | null>`

Private helper function that converts a street address to geographic coordinates using Google Maps Geocoding API.

**Parameters:**
- `address: string` - Street address to geocode

**Returns:**
- `Promise<Coordinates | null>` - Coordinates object or null if geocoding fails

**Process:**
1. Makes request to Google Maps Geocoding API
2. Extracts latitude/longitude from response
3. Returns coordinates or null on failure

**Error Handling:**
- Logs warning for failed geocoding with status code
- Logs error for network/API failures
- Returns null for all error cases

**Example Response:**
```typescript
{
  latitude: 51.0447,
  longitude: -114.0719
}
```

---

## Cleaner Coordinate Functions

### `getCleanerCoordinates(cleanerId: string): Promise<Coordinates | null>`

Retrieves cleaner coordinates, using cached values or geocoding if necessary.

**Parameters:**
- `cleanerId: string` - Unique identifier for the cleaner

**Returns:**
- `Promise<Coordinates | null>` - Coordinates or null if cleaner/address not found

**Behavior:**
1. Fetches cleaner record from database
2. Returns null if cleaner or address doesn't exist
3. **If coordinates cached**: Returns existing coordinates (parsed to numbers)
4. **If not cached**: 
   - Geocodes the address
   - Saves coordinates and timestamp to database
   - Returns new coordinates

**Caching Strategy:**
- Checks for existing `latitude` and `longitude` fields
- Only geocodes if coordinates missing
- Updates `geocodedAt` timestamp when geocoding

**Usage Example:**
```typescript
const coords = await getCleanerCoordinates('cleaner_123');

if (coords) {
  console.log(`Cleaner location: ${coords.latitude}, ${coords.longitude}`);
} else {
  console.log('Could not determine cleaner location');
}
```

---

### `updateCleanerCoordinates(cleanerId: string): Promise<Coordinates | null>`

Forces re-geocoding of cleaner address, updating cached coordinates.

**Parameters:**
- `cleanerId: string` - Unique identifier for the cleaner

**Returns:**
- `Promise<Coordinates | null>` - New coordinates or null if failed

**Use Cases:**
- Address has been updated
- Cached coordinates are incorrect
- Forcing refresh of location data

**Behavior:**
1. Fetches cleaner address
2. Geocodes address (regardless of cached data)
3. Updates database with new coordinates and timestamp
4. Returns new coordinates

**Example:**
```typescript
// After updating cleaner address
await db.update(cleaners)
  .set({ address: '123 New Street, Calgary, AB' })
  .where(eq(cleaners.id, cleanerId));

// Force re-geocode
const newCoords = await updateCleanerCoordinates(cleanerId);
```

---

## Property Coordinate Functions

### `getPropertyCoordinates(propertyId: string): Promise<Coordinates | null>`

Retrieves property coordinates, using cached values or geocoding if necessary.

**Parameters:**
- `propertyId: string` - Unique identifier for the property

**Returns:**
- `Promise<Coordinates | null>` - Coordinates or null if property not found

**Behavior:**
Identical to `getCleanerCoordinates` but operates on properties table:
1. Fetches property record
2. Returns cached coordinates if available
3. Geocodes and caches if not available
4. Returns coordinates or null

**Usage Example:**
```typescript
const propertyCoords = await getPropertyCoordinates('prop_456');

if (propertyCoords) {
  console.log(`Property at: ${propertyCoords.latitude}, ${propertyCoords.longitude}`);
}
```

---

### `updatePropertyCoordinates(propertyId: string): Promise<Coordinates | null>`

Forces re-geocoding of property address, updating cached coordinates.

**Parameters:**
- `propertyId: string` - Unique identifier for the property

**Returns:**
- `Promise<Coordinates | null>` - New coordinates or null if failed

**Behavior:**
Identical to `updateCleanerCoordinates` but operates on properties table.

**Example:**
```typescript
// Force update property coordinates
const coords = await updatePropertyCoordinates('prop_789');
console.log('Property re-geocoded:', coords);
```

---

## Distance Calculation

### `calculateDistance(coord1: Coordinates, coord2: Coordinates): number`

Calculates the great-circle distance between two geographic coordinates using the Haversine formula.

**Parameters:**
- `coord1: Coordinates` - First location coordinates
- `coord2: Coordinates` - Second location coordinates

**Returns:**
- `number` - Distance in miles

**Formula:**
Uses the Haversine formula to calculate great-circle distance:
- Earth radius (R) = 3,959 miles
- Accounts for Earth's curvature
- Returns straight-line distance (not driving distance)

**Usage Example:**
```typescript
const cleanerCoords = { latitude: 51.0447, longitude: -114.0719 };
const propertyCoords = { latitude: 51.0486, longitude: -114.0708 };

const distance = calculateDistance(cleanerCoords, propertyCoords);
console.log(`Distance: ${distance.toFixed(2)} miles`);
// Output: Distance: 0.28 miles
```

**Example Use Case:**
```typescript
// Find cleaners within 10 miles of a property
const propertyCoords = await getPropertyCoordinates(propertyId);

for (const cleaner of cleaners) {
  const cleanerCoords = await getCleanerCoordinates(cleaner.id);
  
  if (cleanerCoords && propertyCoords) {
    const distance = calculateDistance(cleanerCoords, propertyCoords);
    
    if (distance <= 10) {
      console.log(`${cleaner.name} is ${distance.toFixed(2)} miles away`);
    }
  }
}
```

---

### `toRad(degrees: number): number`

Private helper function that converts degrees to radians.

**Parameters:**
- `degrees: number` - Angle in degrees

**Returns:**
- `number` - Angle in radians

**Used by:** `calculateDistance` for trigonometric calculations

---

## Batch Geocoding Functions

### `geocodeAllCleaners(onProgress?: (current: number, total: number) => void): Promise<void>`

Geocodes all cleaners in the database that don't have cached coordinates.

**Parameters:**
- `onProgress?: (current, total) => void` - Optional callback for progress tracking
  - `current: number` - Number of cleaners processed
  - `total: number` - Total number of cleaners to process

**Returns:**
- `Promise<void>` - Resolves when all cleaners are processed

**Behavior:**
1. Queries database for cleaners with null latitude
2. Iterates through each cleaner
3. Geocodes address and updates database
4. Calls progress callback after each cleaner
5. Rate limits with 20ms delay between requests

**Rate Limiting:**
- 20ms delay between requests (~50 requests/second)
- Prevents API quota exhaustion
- Avoid hitting Google Maps API rate limits

**Usage Example:**
```typescript
// With progress tracking
await geocodeAllCleaners((current, total) => {
  const percentage = Math.round((current / total) * 100);
  console.log(`Geocoding progress: ${current}/${total} (${percentage}%)`);
});

console.log('All cleaners geocoded!');
```

**UI Integration Example:**
```typescript
// In a React component or admin tool
const [progress, setProgress] = useState({ current: 0, total: 0 });

async function handleGeocodeAll() {
  await geocodeAllCleaners((current, total) => {
    setProgress({ current, total });
  });
  
  alert('Geocoding complete!');
}

// Display: {progress.current} / {progress.total}
```

---

### `geocodeAllProperties(onProgress?: (current: number, total: number) => void): Promise<void>`

Geocodes all properties in the database that don't have cached coordinates.

**Parameters:**
- `onProgress?: (current, total) => void` - Optional callback for progress tracking

**Returns:**
- `Promise<void>` - Resolves when all properties are processed

**Behavior:**
Identical to `geocodeAllCleaners` but operates on properties table:
1. Queries for properties with null latitude
2. Geocodes each property address
3. Updates database with coordinates
4. Reports progress via callback
5. Rate limits with 20ms delay

**Usage Example:**
```typescript
console.log('Starting property geocoding...');

await geocodeAllProperties((current, total) => {
  if (current % 10 === 0) { // Log every 10 properties
    console.log(`Processed ${current}/${total} properties`);
  }
});

console.log('All properties geocoded!');
```

---

## Database Schema

### Cleaner Fields
```typescript
{
  id: string;
  address: string;
  latitude: string | null;    // Stored as string
  longitude: string | null;   // Stored as string
  geocodedAt: Date | null;    // Timestamp of last geocoding
}
```

### Property Fields
```typescript
{
  id: string;
  address: string;
  latitude: string | null;    // Stored as string
  longitude: string | null;   // Stored as string
  geocodedAt: Date | null;    // Timestamp of last geocoding
}
```

---

## Best Practices

### Coordinate Caching
✅ **DO:**
- Use `get*Coordinates()` functions for read operations
- Let the service handle caching automatically
- Check for null returns before using coordinates

❌ **DON'T:**
- Bypass the cache by always using `update*Coordinates()`
- Store coordinates in separate variables without checking database first

### Address Updates
✅ **DO:**
```typescript
// Update address
await db.update(properties)
  .set({ address: newAddress })
  .where(eq(properties.id, propertyId));

// Force re-geocode
await updatePropertyCoordinates(propertyId);
```

❌ **DON'T:**
```typescript
// Update address without re-geocoding
await db.update(properties)
  .set({ address: newAddress })
  .where(eq(properties.id, propertyId));
// Old coordinates now invalid!
```

### Batch Operations
✅ **DO:**
```typescript
// Rate-limited batch geocoding
await geocodeAllProperties((current, total) => {
  // Progress tracking
});
```

❌ **DON'T:**
```typescript
// Uncontrolled parallel requests
const promises = properties.map(p => updatePropertyCoordinates(p.id));
await Promise.all(promises); // May hit rate limits!
```

---

## Common Use Cases

### 1. Calculate Cleaner-to-Property Distance
```typescript
async function getCleanerDistance(cleanerId: string, propertyId: string) {
  const [cleanerCoords, propertyCoords] = await Promise.all([
    getCleanerCoordinates(cleanerId),
    getPropertyCoordinates(propertyId),
  ]);

  if (!cleanerCoords || !propertyCoords) {
    return null;
  }

  return calculateDistance(cleanerCoords, propertyCoords);
}

const distance = await getCleanerDistance('cleaner_123', 'prop_456');
console.log(`${distance?.toFixed(2)} miles`);
```

### 2. Find Nearby Cleaners
```typescript
async function findNearbyCleaners(
  propertyId: string,
  maxDistance: number = 25
) {
  const propertyCoords = await getPropertyCoordinates(propertyId);
  if (!propertyCoords) return [];

  const allCleaners = await db.query.cleaners.findMany();
  const nearby = [];

  for (const cleaner of allCleaners) {
    const cleanerCoords = await getCleanerCoordinates(cleaner.id);
    
    if (cleanerCoords) {
      const distance = calculateDistance(propertyCoords, cleanerCoords);
      
      if (distance <= maxDistance) {
        nearby.push({ ...cleaner, distance });
      }
    }
  }

  return nearby.sort((a, b) => a.distance - b.distance);
}
```

### 3. Bulk Geocoding with Progress
```typescript
async function geocodeAllData() {
  console.log('Geocoding cleaners...');
  await geocodeAllCleaners((current, total) => {
    console.log(`Cleaners: ${current}/${total}`);
  });

  console.log('Geocoding properties...');
  await geocodeAllProperties((current, total) => {
    console.log(`Properties: ${current}/${total}`);
  });

  console.log('Geocoding complete!');
}
```

---

## Error Handling

### Geocoding Failures
```typescript
const coords = await getPropertyCoordinates(propertyId);

if (!coords) {
  // Handle missing coordinates
  console.log('Could not geocode property');
  // Options:
  // 1. Use default location
  // 2. Mark property for manual review
  // 3. Skip distance calculations
}
```

### Address Validation
```typescript
async function safeGeocode(propertyId: string) {
  try {
    const property = await db.query.properties.findFirst({
      where: eq(properties.id, propertyId),
    });

    if (!property?.address) {
      throw new Error('Property has no address');
    }

    const coords = await getPropertyCoordinates(propertyId);
    
    if (!coords) {
      throw new Error('Geocoding failed');
    }

    return coords;
  } catch (error) {
    console.error('Geocoding error:', error);
    return null;
  }
}
```

---

## API Rate Limits

### Google Maps Geocoding API
- Free tier: ~40,000 requests/month
- Rate limit: ~50 requests/second
- Cost: $5 per 1,000 requests after free tier

### Service Protection
The service includes built-in rate limiting:
- 20ms delay between batch requests (~50 req/sec)
- Sequential processing prevents burst requests
- Caching reduces redundant API calls

---

## Dependencies

- `@/db` - Database instance and schemas
- `drizzle-orm` - ORM for database operations
- Google Maps Geocoding API - Address to coordinate conversion