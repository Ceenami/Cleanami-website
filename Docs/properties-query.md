## 📄 Documentation: Property Data Query Module

This **server-only** module provides functions for fetching comprehensive property data. It is designed to support administrative interfaces by efficiently retrieving property records, linking them to customer ownership, and calculating operational metrics like active subscriptions and job history.

-----

### **`getPropertiesWithOwner(params)`**

Fetches a paginated list of properties, including customer details and key operational aggregates calculated via subqueries. This is ideal for a property management list view.

#### **Signature**

```typescript
export async function getPropertiesWithOwner({
  page = 1,
  limit = 10,
  query = '',
}: GetPropertiesParams): Promise<PaginatedResponse<PropertyListItem>>
```

#### **Parameters**

| Name | Type | Description |
| :--- | :--- | :--- |
| `page`, `limit` | `number` | **(Optional)** Pagination parameters. |
| `query` | `string` | **(Optional)** A search string used to filter properties by **address** or the **customer's name**. |

#### **Data Aggregation and Joins**

The query uses a single `select` with a `leftJoin` to the `customers` table and custom SQL subqueries (`json_build_object`, `COUNT`) to provide enriched data:

| Data Field | Source / Calculation | Details |
| :--- | :--- | :--- |
| **`customer`** | Left join with `customers`. | ID, name, and email of the property owner. |
| **`activeSubscription`** | **SQL Aggregation** (Subquery) | The most recently created subscription with a `status` of `'active'`. Returns key details (ID, status, duration, start date) as a JSON object. |
| **`nextJob`** | **SQL Aggregation** (Subquery) | The single next job associated with the property that is *upcoming* (`checkInTime > NOW()`) and *not yet started* (`status IN ('unassigned', 'assigned')`). |
| **`totalJobs`** | **SQL Aggregation** (Subquery) | Total count of all jobs ever scheduled for the property. |
| **`completedJobs`** | **SQL Aggregation** (Subquery) | Total count of all jobs with a `status` of `'completed'`. |

#### **Filtering and Sorting**

  * **Filtering**: The `where` clause searches against both the **property address** and the **customer's name**.
  * **Sorting**: Results are ordered by **`createdAt` descending**.

#### **Returns**

A promise resolving to a paginated response object containing the list of enriched property items.

-----

### **`getPropertyDetails(propertyId)`**

Fetches a single property record with all associated customer, subscription, job history, and file details. This is designed for a detailed Property Profile view.

#### **Signature**

```typescript
export async function getPropertyDetails(propertyId: string): Promise<PropertyDetails>
```

#### **Parameters**

| Name | Type | Description |
| :--- | :--- | :--- |
| `propertyId` | `string` | The unique ID of the property to retrieve. |

#### **Relational Data Included (`with` clauses)**

The function eagerly loads the following related data:

| Relationship | Details Eagerly Loaded | Sorting & Limit |
| :--- | :--- | :--- |
| **`customer`** | The full customer record. | N/A |
| **`subscriptions`** | All subscriptions for the property. Includes related **jobs** (with assigned cleaners and evidence status). | Subscriptions sorted by `createdAt` descending. Jobs limited to **5** per subscription. |
| **`checklistFiles`** | All uploaded checklist files for the property. | Sorted by `createdAt` descending. |

#### **Client-Side Calculations**

After loading the data, the function performs several utility calculations:

  * **`activeSubscription`**: Finds the single active subscription from the loaded list, or `null`.
  * **`nextJob`**: The single closest upcoming job, filtered from all loaded jobs across all subscriptions.
  * **`upcomingJobs`**: The next **5** upcoming jobs, sorted by `checkInTime`.
  * **`recentJobs`**: The **10** most recently completed jobs, sorted by `createdAt`.
  * **`totalJobs`** and **`completedJobs`**: Total counts derived from the flat list of all loaded jobs.

#### **Returns**

A promise resolving to the enhanced **`PropertyDetails`** object. Throws `notFound()` if the `propertyId` does not match any record.

-----

### **Type Exports**

| Type Name | Type of | Description |
| :--- | :--- | :--- |
| **`PropertiesWithOwner`** | `Awaited<ReturnType<typeof getPropertiesWithOwner>>` | The shape of the data returned by the list function. |
| **`PropertyDetails`** | `Awaited<ReturnType<typeof getPropertyDetails>>` | The shape of the data returned by the detail function, including client-side calculated aggregates and relations. |