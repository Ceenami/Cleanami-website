## 📄 Documentation: Cleaner Availability & Proximity Services

This module contains server-side functions designed to efficiently locate and rank cleaning professionals based on a property's location, distance, and the cleaner's current availability and reliability score.

-----

### **Overview**

  * **Context**: This is a server utility module, likely used by job scheduling or assignment processes. It relies on pre-geocoded data for both properties and cleaners.
  * **Dependencies**:
      * **Drizzle ORM (`db`, `drizzle-orm`)**: For querying cleaner and job/property data.
      * **Google Maps Services (`geocoding.ts`)**: For calculating the distance between two geographical points.
  * **Ranking Logic**: Cleaners are primarily ranked by **Reliability Score (descending)**, and secondarily by **Distance (ascending)**.
  * **Default Radius**: A service area of **25 miles** (`DEFAULT_SERVICE_RADIUS_MILES`) is used unless overridden.

-----

### **Type Definition**

#### **`AvailableCleanerWithDistance`**

This type defines the structure of the data returned for each qualifying cleaner.

```typescript
export type AvailableCleanerWithDistance = {
  id: string;
  fullName: string;
  reliabilityScore: string | null;
  onCallStatus: 'available' | 'unavailable' | 'on_job';
  distance: number; // The distance in miles, rounded to one decimal place.
};
```

-----

### **`getAvailableCleanersForProperty(propertyId, options)`**

Retrieves and ranks all eligible cleaners within a specified radius of a given property.

#### **Signature**

```typescript
export async function getAvailableCleanersForProperty(
  propertyId: string,
  options?: {
    radiusMiles?: number;
    includeOnJob?: boolean;
  }
): Promise<AvailableCleanerWithDistance[]>
```

#### **Parameters**

| Name | Type | Description |
| :--- | :--- | :--- |
| `propertyId` | `string` | The ID of the property to use as the central location. |
| `options.radiusMiles` | `number` | **(Optional)** Overrides the default 25-mile radius. |
| `options.includeOnJob` | `boolean` | **(Optional)** If `false`, cleaners with an `onCallStatus` of `'on_job'` are excluded. Defaults to `true`. |

#### **Process & Logic**

1.  **Property Geocoding**: Fetches the latitude and longitude for the `propertyId` using `getPropertyCoordinates`. Throws an error if the property address cannot be geocoded.
2.  **Cleaner Data Retrieval**: Queries the database for all cleaners who have valid coordinates and a defined `onCallStatus`.
3.  **Distance Calculation**: Calculates the straight-line distance (in miles) between the property and each cleaner's location.
4.  **Filtering**:
      * Excludes any cleaner whose distance exceeds the defined `radiusMiles`.
      * Excludes cleaners with `onCallStatus: 'on_job'` if `includeOnJob` is explicitly set to `false`.
5.  **Sorting**: Ranks the resulting list:
      * **Primary Sort**: Highest `reliabilityScore` first.
      * **Secondary Sort**: Closest `distance` first.

#### **Returns**

A promise resolving to an array of **`AvailableCleanerWithDistance`** objects.

-----

### **`getAvailableCleanersForJob(jobId, options)`**

A convenience function that finds the available cleaners for the property associated with a specific job.

#### **Signature**

```typescript
export async function getAvailableCleanersForJob(
  jobId: string,
  options?: {
    radiusMiles?: number;
    includeOnJob?: boolean;
  }
): Promise<{
  cleaners: AvailableCleanerWithDistance[];
  propertyId: string;
  propertyAddress: string;
}>
```

#### **Parameters**

| Name | Type | Description |
| :--- | :--- | :--- |
| `jobId` | `string` | The ID of the job whose property is needed for the calculation. |
| `options` | `object` | Same options as `getAvailableCleanersForProperty`. |

#### **Process**

1.  Fetches the job record, including its associated property ID and address.
2.  Delegates the core logic to `getAvailableCleanersForProperty` using the retrieved `propertyId`.

#### **Returns**

A promise resolving to an object containing the list of ranked **`cleaners`**, the **`propertyId`**, and the **`propertyAddress`**.

-----

### **`getClosestCleanerForProperty(propertyId, options)`**

Quickly finds the single best-suited cleaner that is currently fully available (not `'on_job'`).

#### **Signature**

```typescript
export async function getClosestCleanerForProperty(
  propertyId: string,
  options?: {
    radiusMiles?: number;
  }
): Promise<AvailableCleanerWithDistance | null>
```

#### **Parameters**

| Name | Type | Description |
| :--- | :--- | :--- |
| `propertyId` | `string` | The ID of the property. |
| `options.radiusMiles` | `number` | **(Optional)** Overrides the default radius. |

#### **Process**

1.  Calls `getAvailableCleanersForProperty` with `includeOnJob: false` (excluding cleaners who are currently on a job).
2.  Returns the first element of the resulting sorted array (the highest-ranked available cleaner).

#### **Returns**

A promise resolving to a single **`AvailableCleanerWithDistance`** object or `null` if no suitable, fully available cleaner is found.