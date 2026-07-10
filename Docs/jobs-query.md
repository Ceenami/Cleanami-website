## 📄 Documentation: Job Data Query Module

This **server-only** module contains essential functions for fetching job data, optimized for list views, calendar views, and detailed inspection screens. It incorporates complex filtering, search, pagination, and data aggregation via custom SQL and Drizzle ORM relations.

-----

### **`getJobsWithDetails(params)`**

Fetches a paginated and filtered list of jobs, enriched with key property, subscription, assignment, and payment details. This is ideal for a job management table view.

#### **Signature**

```typescript
export async function getJobsWithDetails({
  page = 1,
  limit = 10,
  status = 'all',
  query = '',
  startDate,
  endDate,
  propertyId,
  cleanerId,
}: GetJobsParams): Promise<PaginatedResponse<JobListItem>>
```

#### **Parameters**

| Name | Type | Description |
| :--- | :--- | :--- |
| `page`, `limit` | `number` | **(Optional)** Pagination parameters. |
| `status` | `JobStatus \| 'all'` | **(Optional)** Filters jobs by status (`unassigned`, `assigned`, etc.). Defaults to `'all'`. |
| `query` | `string` | **(Optional)** Searches against the **property address**. |
| `startDate`, `endDate` | `Date` | **(Optional)** Filters jobs by the `checkInTime` falling within this date range. |
| `propertyId` | `string` | **(Optional)** Filters jobs belonging to a specific property. |
| `cleanerId` | `string` | **(Optional)** Filters jobs assigned to a specific cleaner (applied **after** the main query). |

#### **Data Aggregation and Joins**

The query uses a single, optimized `select` with `leftJoin`s and custom SQL subqueries (`json_agg`, `json_build_object`, `SUM`) to return rich data in a single pass:

| Data Field | Source / Calculation | Details |
| :--- | :--- | :--- |
| **`property`** | Left join with `properties`. | Basic property details (address, beds/baths, hot tub, laundry). |
| **`subscription`** | Left join with `subscriptions`. | Subscription ID, status, and duration. |
| **`assignedCleaners`** | **SQL Aggregation** (Subquery) | JSON array of assigned cleaners, including their ID, name, and role (`jobsToCleaners.role`). |
| **`evidencePacket`** | **SQL Aggregation** (Subquery) | Basic evidence packet status and a count of attached photos. |
| **`totalPayout`** | **SQL Aggregation** (Subquery) | Sum of all `amount`s from the `payouts` table for this job. |
| **`payoutStatus`** | **SQL Aggregation** (Subquery) | The status of the first payout found for the job (e.g., `'pending'`, `'released'`). |

#### **Filtering Logic**

The `where` clause combines:

1.  Filtering by `status`, `startDate`/`endDate`, and `propertyId`.
2.  Searching against the **property address** using `query`.
3.  **Post-Query Filtering**: If a `cleanerId` is provided, the results are filtered in TypeScript by checking the contents of the `assignedCleaners` array.

#### **Returns**

A promise resolving to a paginated response object containing the list of enriched job items.

-----

### **`getJobDetails(jobId)`**

A detailed query to fetch all information necessary for a single job's detail view (similar to the previously documented version, but with updated cleaner/payout logic).

#### **Signature**

```typescript
export async function getJobDetails(jobId: string): Promise<JobDetails>
```

#### **Key Relational Data**

  * **`property.customer`**: Full customer contact details.
  * **`property.checklistFiles`**: The single most recent checklist file for the property.
  * **`cleaners`**: Assigned cleaners, with their payouts *specifically for this job* nested inside the cleaner's record.
  * **`evidencePacket`** and **`payouts`**: Full records.

#### **Client-Side Calculations**

  * **`totalPayout`**: Sum of all payout amounts, formatted to two decimal places.
  * **`hasEvidencePacket`**: Boolean flag.
  * **`isPayoutComplete`**: Boolean indicating if all associated payouts have a status of `'released'`.

-----

### **`getJobsForCalendar({ startDate, endDate })`**

Fetches all jobs scheduled to start within a specific date range, optimized for calendar visualization.

#### **Signature**

```typescript
export async function getJobsForCalendar({
  startDate,
  endDate,
}: {
  startDate: Date;
  endDate: Date;
}): Promise<Record<string, JobData[]>>
```

#### **Process & Output**

1.  **Date Filtering**: Selects jobs where `checkInTime` is between `startDate` and `endDate`.
2.  **Eager Loading**: Includes basic `property.address` and `cleaners.fullName` for quick display.
3.  **Grouping**: The results are post-processed in TypeScript to group jobs into an object where the keys are **ISO date strings** (e.g., `'2025-10-07'`) and the values are arrays of jobs for that day.

#### **Returns**

A promise resolving to a dictionary (`Record<string, JobData[]>`) of jobs grouped by their check-in date.

-----

### **Type Exports**

| Type Name | Type of | Description |
| :--- | :--- | :--- |
| **`JobsWithDetails`** | `Awaited<ReturnType<typeof getJobsWithDetails>>` | The shape of the data returned by the main list function. |
| **`JobDetails`** | `Awaited<ReturnType<typeof getJobDetails>>` | The shape of the data returned by the detail view function. |
| **`JobsForCalendar`** | `Awaited<ReturnType<typeof getJobsForCalendar>>` | The shape of the data returned by the calendar function (an object mapping dates to job arrays). |