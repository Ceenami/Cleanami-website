## 📄 Documentation: Cleaner Data Query Module

This server-only module provides functions for fetching comprehensive, paginated, and detailed data about cleaning professionals from the database. It combines core cleaner data with various aggregates (jobs, earnings) and detailed relational history (jobs, payouts, availability).

-----

### **Overview**

  * **Context**: This module is tagged `'server-only'`, meaning its functions are secure and intended for backend or Server Component execution, typically for administrative or high-privilege views.
  * **Dependencies**: Uses Drizzle ORM for complex SQL queries, including custom `sql` expressions for efficient aggregation. It relies on internal utility functions (`queryBuilder.ts`) for search and pagination logic.
  * **Focus**: Provides both an overview (for a list view) and a deep-dive (for a detail view) of cleaner performance and status.

-----

### **`getCleaners(params)`**

Fetches a paginated list of cleaners, enriched with key performance indicators (KPIs) calculated via subqueries.

#### **Signature**

```typescript
export async function getCleaners({ 
  page = 1, 
  limit = 15,
  query = '' 
}: GetCleanersParams): Promise<PaginatedResponse<CleanerListItem>>
```

#### **Parameters**

| Name | Type | Description |
| :--- | :--- | :--- |
| `page` | `number` | **(Optional)** The page number to fetch. Defaults to `1`. |
| `limit` | `number` | **(Optional)** The maximum number of results per page. Defaults to `15`. |
| `query` | `string` | **(Optional)** A search string used to filter cleaners by `fullName`, `email`, or `phone`. |

#### **Data Aggregation via Subqueries**

The query uses efficient SQL subqueries to calculate the following metrics for each cleaner:

| Column | Calculation Logic |
| :--- | :--- |
| **`totalJobs`** | Count of all jobs marked `'completed'` where the cleaner was assigned. |
| **`jobsThisMonth`** | Count of jobs marked `'completed'` that have a `checkOutTime` greater than or equal to the first day of the current month. |
| **`totalEarnings`** | Sum of all `amount`s from records in the `payouts` table where `status` is `'released'`. |
| **`pendingPayouts`** | Sum of all `amount`s from records in the `payouts` table where `status` is `'pending'`. |

#### **Sorting and Filtering**

  * **Filtering**: The `query` parameter is used to filter records based on a match in `fullName`, `email`, or `phone`.
  * **Sorting**: Results are ordered by **`createdAt` descending** (most recently added cleaner first).

#### **Returns**

A promise resolving to a paginated response object containing the cleaner data and pagination metadata.

-----

### **`getCleanerById(cleanerId)`**

Fetches a single cleaner record with all associated detailed historical data.

#### **Signature**

```typescript
export async function getCleanerById(cleanerId: string): Promise<CleanerDetails>
```

#### **Parameters**

| Name | Type | Description |
| :--- | :--- | :--- |
| `cleanerId` | `string` | The unique ID of the cleaner to retrieve. |

#### **Relational Data Included (`with` clauses)**

The function eagerly loads the following related data, typically for a profile or detail page:

| Relationship | Details | Sorting & Limit |
| :--- | :--- | :--- |
| **`jobs`** | All jobs the cleaner was assigned to (`jobsToCleaners` join). Includes property address, subscription details, and evidence packet data. | Sorted by job ID descending (most recent first), limited to **50** records. |
| **`payouts`** | All payout records associated with the cleaner. Includes linked job ID and status. | Sorted by creation date descending, limited to **50** records. |
| **`availabilities`** | Availability records submitted by the cleaner. | Sorted by date descending, limited to **30** records. |

#### **Returns**

A promise resolving to the **`CleanerDetails`** object. Throws an error if the `cleanerId` is not found.

-----

### **Type Exports**

| Type Name | Type of | Description |
| :--- | :--- | :--- |
| **`CleanersResponse`** | `Awaited<ReturnType<typeof getCleaners>>` | The shape of the data returned by the list function, including pagination meta-data. |
| **`CleanerDetails`** | `Awaited<ReturnType<typeof getCleanerById>>` | The shape of the data returned by the detail function, including all related jobs, payouts, and availabilities. |