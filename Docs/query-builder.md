## 📄 Documentation: Query Builder Utilities (`queryBuilder.ts`)

This server-side utility module provides standardized functions, types, and SQL expressions to simplify common Drizzle ORM query patterns, including **pagination**, **searching**, **filtering**, and **aggregation**. It ensures consistent implementation across the application's data layer.

***

## 🧩 Type Definitions

| Interface/Type | Purpose | Fields |
| :--- | :--- | :--- |
| **`PaginationParams`** | Defines the optional parameters for handling pagination. | `page?: number`, `limit?: number` |
| **`SearchParams`** | Defines the optional parameter for searching. | `query?: string` |
| **`PaginatedResponse<T>`** | The standardized response structure for all paginated queries. | `data: T[]`, `nextPage: number \| null`, `page: number`, `limit: number`, `total?: number` |

***

## ⚙️ Pagination Helpers

| Function | Signature | Description |
| :--- | :--- | :--- |
| **`getPaginationOffset`** | `(page, limit): number` | Calculates the starting index (**SQL `OFFSET`**) for a given page and limit. |
| **`getNextPage`** | `(currentPage, dataLength, limit): number \| null` | Determines if there is a next page. Returns the next page number if the length of the fetched data equals the limit, otherwise returns `null`. |
| **`buildPaginatedResponse`** | `(data, page, limit, total?): PaginatedResponse<T>` | Assembles the standardized `PaginatedResponse` object using the results and calculated metadata. |

***

## 🔍 Search and Filter Conditions

| Function | Signature | Description |
| :--- | :--- | :--- |
| **`buildSearchCondition`** | `(query, fields): SQL \| undefined` | Constructs a **Drizzle `or`** condition using the **`ilike` (case-insensitive LIKE)** operator for the provided `fields`. Returns `undefined` if the query is empty. |
| **`filters.byStatus`** | `(statusField, status): SQL \| undefined` | Returns an `eq` condition for the given `statusField` if `status` is not `'all'`, otherwise returns `undefined`. |
| **`filters.byDateRange`** | `(dateField, start?, end?): SQL \| undefined` | Constructs an **`and`** condition to filter a `dateField` between the optional `start` and `end` dates. |
| **`filters.byBoolean`** | `(field, value): SQL \| undefined` | Returns an `eq` condition for a boolean field if `value` is explicitly `true` or `false`, otherwise returns `undefined`. |

***

## 📊 SQL Aggregation Helpers (`aggregations`)

This object provides reusable Drizzle **`sql`** templates for common aggregate functions, casting the results for consistent number/text types in the application.

| Function | Drizzle ORM Equivalent | Description |
| :--- | :--- | :--- |
| **`count`** | `COUNT(field)` | Casts the total count of a field to an **integer**. |
| **`countDistinct`** | `COUNT(DISTINCT field)` | Casts the count of unique values of a field to an **integer**. |
| **`countWhere`** | `COUNT(CASE WHEN condition THEN 1 END)` | Counts rows that satisfy a specific **SQL `condition`**, cast to an **integer**. |
| **`sum`** | `COALESCE(SUM(field), 0)` | Calculates the sum of a field, defaults to `0`, and casts the result to **text** (useful for large monetary values). |
| **`avg`** | `AVG(field)` | Calculates the average of a field, cast to **text**. |

***

## ➡️ Ordering Helpers (`ordering`)

This object provides simple, reusable functions for common sort orders.

| Function | Drizzle ORM Equivalent | Description |
| :--- | :--- | :--- |
| **`createdAtDesc`** | `desc(table.createdAt)` | Sorts results by the `createdAt` timestamp in descending order (newest first). |
| **`updatedAtDesc`** | `desc(table.updatedAt)` | Sorts results by the `updatedAt` timestamp in descending order. |