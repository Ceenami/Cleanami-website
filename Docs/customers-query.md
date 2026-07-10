## 📄 Documentation: Customer Data Query Module

This **server-only** module contains essential functions for fetching, aggregating, and detailing customer and related operational data from the database. It is designed for use in administrative interfaces where performance and data completeness are required.

-----

### **`getCustomersWithPropertyCount(params)`**

Fetches a paginated list of all customers, enriched with key metrics calculated via aggregated subqueries.

#### **Signature**

```typescript
export async function getCustomersWithPropertyCount({
  page = 1,
  limit = 10,
  query = '',
}: GetCustomersParams): Promise<PaginatedResponse<CustomerListItem>>
```

#### **Parameters**

| Name | Type | Description |
| :--- | :--- | :--- |
| `page` | `number` | **(Optional)** The page number to fetch. Defaults to `1`. |
| `limit` | `number` | **(Optional)** The maximum number of results per page. Defaults to `10`. |
| `query` | `string` | **(Optional)** A search string used to filter customers by `name`, `email`, or `phone`. |

#### **Data Aggregation via Subqueries**

The query uses efficient SQL subqueries to calculate the following metrics for each customer:

| Column | Calculation Logic |
| :--- | :--- |
| **`propertyCount`** | Total number of properties associated with the customer. |
| **`activeSubscriptionCount`** | Total number of subscriptions with a `status` of `'active'`. |
| **`totalSubscriptions`** | Total number of all subscriptions (regardless of status). |
| **`completedJobs`** | Total number of jobs associated with any of the customer's properties that have a `status` of `'completed'`. |

#### **Returns**

A promise resolving to a paginated response object containing customer list items and pagination metadata.

-----

### **`getCustomerDetails(customerId)`**

Fetches a single customer record with all associated relational data for a detailed profile view.

#### **Signature**

```typescript
export async function getCustomerDetails(customerId: string): Promise<CustomerDetails>
```

#### **Parameters**

| Name | Type | Description |
| :--- | :--- | :--- |
| `customerId` | `string` | The unique ID of the customer to retrieve. |

#### **Relational Data Included (`with` clauses)**

The function eagerly loads the following related data:

| Relationship | Details |
| :--- | :--- |
| **`properties`** | All properties owned by the customer, including linked **`subscriptions`** and **`checklistFiles`** for each property. |
| **`subscriptions`** | All subscriptions for the customer. Includes limited property details, and up to **10 recent jobs** per subscription. |
| **`jobs` (via Subscriptions)** | Includes assigned cleaners and a limited evidence packet status for each job. |

#### **Client-Side Aggregations**

After fetching the data, the function performs calculations on the returned object before sending it:

  * **`totalProperties`**: Count of loaded properties.
  * **`activeSubscriptions`**: Count of loaded subscriptions where status is `'active'`.
  * **`totalJobs`**: Total count of all jobs across all subscriptions.
  * **`completedJobs`**: Count of completed jobs across all subscriptions.
  * **`recentJobs`**: The 20 most recent jobs across all subscriptions, sorted by `createdAt`.

#### **Returns**

A promise resolving to the enhanced **`CustomerDetails`** object. Throws `notFound()` if the customer ID is not found.

-----

### **`getCustomerJobHistory(params)`**

Fetches a paginated history of all jobs associated with a customer's properties.

#### **Signature**

```typescript
export async function getCustomerJobHistory({
  customerId,
  page = 1,
  limit = 20,
}: { customerId: string } & PaginationParams): Promise<PaginatedResponse<JobHistoryItem>>
```

#### **Parameters**

| Name | Type | Description |
| :--- | :--- | :--- |
| `customerId` | `string` | The ID of the customer. |
| `page` | `number` | **(Optional)** The page number to fetch. Defaults to `1`. |
| `limit` | `number` | **(Optional)** The maximum number of jobs per page. Defaults to `20`. |

#### **Process & Logic**

1.  **Property ID Lookup**: Selects all `id`s of properties belonging to the `customerId`.
2.  **Job Count (Aggregation)**: Calculates the total count of jobs and the total completed jobs across all identified property IDs.
3.  **Job Data Fetch**: Queries the `jobs` table using `inArray` to match jobs to the list of property IDs.
4.  **Eager Loading**: Includes property address, assigned cleaners' full names, and key evidence packet statuses.
5.  **Pagination**: Applies `limit` and `offset` and sorts the results by `createdAt` descending.

#### **Returns**

A promise resolving to a paginated response object containing the job history data.

-----

### **Type Exports**

| Type Name | Type of | Description |
| :--- | :--- | :--- |
| **`CustomersResponse`** | `Awaited<ReturnType<typeof getCustomersWithPropertyCount>>` | The shape of the data returned by the list function. |
| **`CustomerDetails`** | `Awaited<ReturnType<typeof getCustomerDetails>>` | The shape of the data returned by the detail function, including client-side calculated aggregates and relations. |
| **`CustomerJobHistoryResponse`** | `Awaited<ReturnType<typeof getCustomerJobHistory>>` | The shape of the data returned by the job history function. |