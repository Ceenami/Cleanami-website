## 📄 Documentation: Subscription Data Query Module

This **server-only** module contains core functions for fetching detailed and aggregated data about customer subscriptions. It is designed to support administrative interfaces by efficiently linking subscriptions to customers, properties, and associated job history.

-----

### **`getSubscriptionsWithDetails(params)`**

Fetches a paginated and filtered list of subscriptions, enriched with key property, customer, and job metrics using optimized joins and subqueries. This is ideal for a central subscription management list view.

#### **Signature**

```typescript
export async function getSubscriptionsWithDetails({
  page = 1,
  limit = 10,
  status = 'all',
  query = '',
}: GetSubscriptionsParams): Promise<PaginatedResponse<SubscriptionListItem>>
```

#### **Parameters**

| Name | Type | Description |
| :--- | :--- | :--- |
| `page`, `limit` | `number` | **(Optional)** Pagination parameters. |
| `status` | `SubscriptionStatus \| 'all'` | **(Optional)** Filters subscriptions by status (`active`, `expired`, etc.). Defaults to `'all'`. |
| `query` | `string` | **(Optional)** A search string used to filter by **property address** or the **customer's name/email**. |

#### **Data Aggregation and Joins**

The query uses `innerJoin`s to link to the required `properties` and `customers` tables, and utilizes custom SQL subqueries (`COUNT`, `json_build_object`) to efficiently aggregate job metrics:

| Data Field | Source / Calculation | Details |
| :--- | :--- | :--- |
| **`property`** | Inner join with `properties`. | Basic property details (address, beds/baths, hot tub, laundry). |
| **`customer`** | Inner join with `customers`. | ID, name, and email of the customer. |
| **`totalJobs`** | **SQL Aggregation** (Subquery) | Total count of all jobs associated with this subscription. |
| **`completedJobs`** | **SQL Aggregation** (Subquery) | Total count of jobs with a `status` of `'completed'`. |
| **`upcomingJobs`** | **SQL Aggregation** (Subquery) | Count of jobs with a status of `'unassigned'` or `'assigned'` and a `checkInTime > NOW()`. |
| **`nextJobDate`** | **SQL Aggregation** (Subquery) | The `checkInTime` of the single closest upcoming job. |

#### **Filtering and Sorting**

  * **Filtering**: The `where` clause combines filtering by `status` with a search against the property address, customer name, and customer email.
  * **Sorting**: Results are ordered by **`createdAt` descending**.

#### **Returns**

A promise resolving to a paginated response object containing the list of enriched subscription items.

-----

### **`getSubscriptionDetails(subscriptionId)`**

Fetches a single subscription record with all associated customer, property, and comprehensive job history details. This is designed for a detailed Subscription Profile view.

#### **Signature**

```typescript
export async function getSubscriptionDetails(subscriptionId: string): Promise<SubscriptionDetails>
```

#### **Parameters**

| Name | Type | Description |
| :--- | :--- | :--- |
| `subscriptionId` | `string` | The unique ID of the subscription to retrieve. |

#### **Relational Data Included (`with` clauses)**

The function eagerly loads the following related data:

| Relationship | Details Eagerly Loaded | Sorting |
| :--- | :--- | :--- |
| **`property`** | The property record, including the **latest checklist file**. | N/A |
| **`customer`** | The full customer record. | N/A |
| **`jobs`** | All jobs linked to the subscription. Includes assigned **cleaners**, basic **evidence packet** status, and **payout** details. | Sorted by `checkInTime` descending (most recent first). |

#### **Client-Side Processing and Calculations**

After loading the data, the function performs extensive filtering, sorting, and counting on the job list to organize the subscription's history:

  * **Job Status Grouping**: Jobs are filtered into separate arrays based on their status: `upcomingJobs`, `inProgressJobs`, `completedJobs`, `canceledJobs`, and `unassignedJobs`.
  * **`nextJob`**: The single closest job from the `upcomingJobs` array.
  * **Counting**: Separate counts (`totalJobs`, `upcomingJobCount`, etc.) are calculated for each job group.
  * **Limiting**: The returned arrays for `upcomingJobs` and `completedJobs` are sliced to include only the most relevant, recent items (10 and 20 respectively).

#### **Returns**

A promise resolving to the enhanced **`SubscriptionDetails`** object. Throws an `Error` if the `subscriptionId` is not found.