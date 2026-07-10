# ICalService Documentation

## Overview

The `ICalService` class handles synchronization of iCal calendar events with the job management system. It fetches calendar data from external iCal URLs, processes events, calculates expected job durations, and stores jobs in the database with automatic upsert handling.

## Class: `ICalService`

### Constructor

```typescript
constructor(db: DrizzleDb)
```

**Parameters:**
- `db: DrizzleDb` - Drizzle ORM database instance with schema

---

## Public Methods

### `syncCalendar(args: SyncInput): Promise<SyncResult>`

Synchronizes calendar events from an iCal URL into the jobs database.

**Parameters:**
- `args: SyncInput` - Object containing either:
  - `subscriptionId?: string` - ID of subscription to sync
  - `propertyId?: string` - ID of property to sync

**Returns:**
- `Promise<Object>` with properties:
  - `success: boolean` - Whether sync completed successfully
  - `message?: string` - Status or error message
  - `totalSynced?: number` - Number of jobs successfully synced

**Process Flow:**
1. Validates input and resolves context (subscription, property, iCal URL)
2. Fetches and parses calendar data from iCal URL
3. Retrieves property details for job calculations
4. Processes events in batches and saves to database
5. Returns sync results

**Example Usage:**

```typescript
const icalService = new ICalService(db);

// Sync by subscription ID
const result = await icalService.syncCalendar({ 
  subscriptionId: 'sub_123' 
});

// Sync by property ID
const result = await icalService.syncCalendar({ 
  propertyId: 'prop_456' 
});

console.log(result);
// {
//   success: true,
//   message: "Successfully synced 25 of 25 total events.",
//   totalSynced: 25
// }
```

---

## Private Methods

### `_getContext(args: SyncInput): Promise<ContextResult>`

Resolves and validates the sync context (subscription, property, and iCal URL).

**Parameters:**
- `args: SyncInput` - Input arguments with subscriptionId or propertyId

**Returns:**
- `Promise<Object>` with properties:
  - `success: boolean` - Whether context was successfully resolved
  - `data?: SyncContext` - Context object containing:
    - `subscriptionId: string`
    - `propertyId: string`
    - `iCalUrl: string`
  - `message?: string` - Error message if unsuccessful

**Logic:**
- **If subscriptionId provided**: Fetches subscription with property relation, extracts iCal URL
- **If propertyId provided**: Fetches property and active subscription, validates iCal URL exists
- **Validation**: Ensures required data exists and returns structured context

---

### `_fetchAndParseCalendar(url: string): Promise<VEvent[] | null>`

Fetches calendar data from iCal URL and parses it into event objects.

**Parameters:**
- `url: string` - iCal feed URL

**Returns:**
- `Promise<VEvent[] | null>` - Array of VEVENT objects, or null if fetch/parse fails

**Process:**
1. Fetches raw ICS data via HTTP
2. Parses ICS format using node-ical library
3. Filters for VEVENT type entries
4. Returns array of calendar events

**Error Handling:**
- Logs errors to console
- Returns null on any fetch or parse failure

---

### `_calculateExpectedHours(property: PropertyDetails): number`

Calculates expected job duration based on property characteristics and services.

**Parameters:**
- `property: PropertyDetails` - Object containing:
  - `bedCount: number` - Number of bedrooms
  - `bathCount: string` - Number of bathrooms
  - `sqFt: number | null` - Property square footage
  - `laundryType: string` - Type of laundry service ('off_site', 'in_unit', etc.)
  - `laundryLoads: number | null` - Number of laundry loads
  - `hotTubServiceLevel: boolean` - Whether hot tub service is included
  - `hotTubDrainCadence: string | null` - Hot tub drain frequency

**Returns:**
- `number` - Expected hours rounded to 2 decimal places

**Calculation Formula:**

```
Base Time = -0.585 + (0.95 × bedrooms) + (0.62 × bathrooms)

If sqFt exists:
  Base Time += 0.1905 × (sqFt / 250)

Job Size Determination:
  - Small: bedrooms ≤ 2
  - Medium: bedrooms 3-4
  - Large: bedrooms ≥ 5

If Off-Site Laundry:
  - Small jobs: +1.25 hours
  - Medium jobs: +1.75 hours
  - Large jobs: +2.25 hours

If Hot Tub Service:
  Base Time += 0.333 hours

Final: Round to 2 decimal places
```

**Example:**
```typescript
// 3 bed, 2 bath, 1800 sqft, off-site laundry, hot tub
const hours = _calculateExpectedHours({
  bedCount: 3,
  bathCount: '2',
  sqFt: 1800,
  laundryType: 'off_site',
  laundryLoads: 2,
  hotTubServiceLevel: true,
  hotTubDrainCadence: 'monthly'
});
// Result: ~7.68 hours
```

---

### `_processAndSaveEventsInBatches(events, context, property): Promise<BatchResult>`

Processes calendar events in batches and saves/updates jobs in the database.

**Parameters:**
- `events: VEvent[]` - Array of parsed calendar events
- `context: { subscriptionId: string, propertyId: string }` - Job context
- `property: PropertyDetails` - Property details for calculations

**Returns:**
- `Promise<Object>` with properties:
  - `message: string` - Summary of sync operation
  - `totalSynced: number` - Count of successfully synced jobs

**Process:**
1. Calculates expected hours once for all events
2. Maps events to job insert objects with:
   - Context (subscription and property IDs)
   - Check-in/check-out times from event
   - Calendar event UID for deduplication
   - Status set to 'unassigned'
   - Expected hours from calculation
   - Addons snapshot for historical tracking
3. Processes in batches of 100 jobs
4. Uses upsert logic (insert or update on conflict)
5. Tracks total synced count

**Upsert Behavior:**
- **Conflict Target**: `calendarEventUid`
- **On Conflict**: Updates `checkInTime`, `checkOutTime`, `expectedHours`, `addonsSnapshot`
- **Preserves**: Existing job ID, status, assignments

---

## Type Definitions

### `SyncInput`
```typescript
{
  subscriptionId?: string;  // Either this
  propertyId?: string;      // Or this (mutually exclusive)
}
```

### `SyncContext`
```typescript
{
  subscriptionId: string;
  propertyId: string;
  iCalUrl: string;
}
```

### `PropertyDetails`
```typescript
{
  bedCount: number;
  bathCount: string;
  sqFt: number | null;
  laundryType: string;
  laundryLoads: number | null;
  hotTubServiceLevel: boolean;
  hotTubDrainCadence: string | null;
}
```

---

## Configuration

### Constants
- `BATCH_SIZE`: 100 events per database batch operation

---

## Data Flow

```
User Request (subscriptionId or propertyId)
              ↓
    Resolve Context (_getContext)
              ↓
    Fetch iCal Data (_fetchAndParseCalendar)
              ↓
    Parse Events (node-ical)
              ↓
    Fetch Property Details
              ↓
    Calculate Expected Hours (_calculateExpectedHours)
              ↓
    Map Events to Jobs
              ↓
    Process in Batches (_processAndSaveEventsInBatches)
              ↓
    Upsert to Database (insert with onConflictDoUpdate)
              ↓
    Return Results
```

---

## Database Operations

### Tables Accessed
- `properties` - Property details and iCal URLs
- `subscriptions` - Active subscriptions
- `jobs` - Job records (insert/update)

### Insert Strategy
- Uses **upsert pattern** via `onConflictDoUpdate`
- Prevents duplicate jobs by matching `calendarEventUid`
- Updates existing jobs with latest calendar data
- Preserves job status and assignment information

---

## Error Handling

### Validation Errors
- Missing subscription/property returns failure message
- Missing iCal URL returns specific error
- No active subscription returns descriptive error

### Fetch Errors
- Calendar fetch failures logged to console
- Returns null to trigger graceful failure
- Batch processing continues on individual batch errors

### Batch Processing
- Each batch wrapped in try-catch
- Failed batches logged with index
- Successful batches counted toward total
- Partial success possible (some batches succeed)

---

## Example Complete Flow

```typescript
import { ICalService } from './ical-service';
import { db } from '@/db';

const icalService = new ICalService(db);

// Trigger sync for a property
const result = await icalService.syncCalendar({ 
  propertyId: 'prop_abc123' 
});

if (result.success) {
  console.log(`✓ ${result.totalSynced} jobs synced`);
  console.log(result.message);
} else {
  console.error(`✗ Sync failed: ${result.message}`);
}
```

---

## Dependencies

- `@/db` - Database instance and schema
- `drizzle-orm` - ORM for database operations
- `node-ical` - iCal parsing library
- `node-postgres` - PostgreSQL driver

---

## Performance Considerations

- **Batch Processing**: Handles large calendars (100 events per batch)
- **Parallel Queries**: Uses `Promise.all` internally where beneficial
- **Upsert Efficiency**: Single query per batch for insert/update
- **Memory Management**: Processes events in chunks to avoid memory issues

---

## Addons Snapshot

The service stores a snapshot of addon services with each job:

```typescript
addonsSnapshot: {
  laundryType: string;           // 'off_site', 'in_unit', 'none'
  laundryLoads: number | null;   // Number of loads
  hotTubServiceLevel: string;    // 'basic', 'none'
  hotTubDrainCadence: string | null;  // 'monthly', 'quarterly', etc.
}
```

This preserves historical pricing/service configuration even if property settings change later.