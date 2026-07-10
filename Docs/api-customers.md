## API Endpoint: Retrieve Customer List (GET)

-----

### 🚀 Overview

This Next.js API route handles `GET` requests to retrieve a list of customers. It supports **pagination**, **limiting** the number of results, and **full-text searching** across customer data. Crucially, the data fetched for each customer includes a count of their associated properties.

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/customers` (Assuming a common REST structure) | Retrieves a paginated and searchable list of customers, including their property count. |

-----

### 🛠️ Implementation Details

#### **File Location**

This code snippet is likely part of a file named `route.ts` within the customers API folder, such as:

```
app/api/customers/route.ts
```

#### **Dependencies**

The route relies on the following imports:

| Import | Source | Purpose |
| :--- | :--- | :--- |
| `NextRequest`, `NextResponse` | `  "next/server" ` | Next.js utilities for handling incoming requests and crafting responses. |
| `getCustomersWithPropertyCount` | `  "@/lib/queries/customers" ` | A service function that performs the database query for fetching customers with their property counts, supporting pagination and search. |

-----

### 📝 `GET` Handler Function (`GET`)

This function executes the customer retrieval operation.

#### **Signature**

```typescript
export async function GET(request: NextRequest)
```

#### **Logic Breakdown**

1.  **Extract and Parse Query Parameters:**

    ```typescript
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const query = searchParams.get('query') || '';
    ```

      * It extracts the URL search parameters (`?page=2&limit=5&query=john`).
      * It safely parses the `page` and `limit` parameters as integers, defaulting to `1` and `10` respectively if they are missing or invalid.
      * It extracts the `query` string for searching, defaulting to an empty string.

2.  **Fetch Data from Service Layer:**

    ```typescript
    const result = await getCustomersWithPropertyCount({ page, limit, query });
    ```

      * It calls the dedicated service function, passing the parsed pagination and search parameters. This function is responsible for the actual database interaction (likely Drizzle/Prisma/etc.).

3.  **Successful Response:**

    ```typescript
    return NextResponse.json(result);
    ```

      * If the database operation succeeds, it returns the result object (which typically includes the customer list, total count, and pagination metadata) as a JSON response.

4.  **Error Handling (Try-Catch):**

    ```typescript
    // ... inside catch block
    console.error('Error fetching customers:', error);
    return NextResponse.json(
      { error: 'Failed to fetch customers' },
      { status: 500 }
    );
    ```

      * If any error occurs during the process (e.g., database connection failure, query error), the error is logged to the console.
      * It returns a standard **HTTP 500 (Internal Server Error)** response with a user-friendly error message.

-----

### 💡 How to Use (Client-Side Example)

To fetch the second page of results, showing 5 customers per page, and searching for the name "Smith," a client would call the endpoint with query parameters:

#### **Request Examples**

| Action | URL Example | Description |
| :--- | :--- | :--- |
| **Default Fetch** | `/api/customers` | Fetches the first page (page 1) with 10 results. |
| **Pagination** | `/api/customers?page=3&limit=25` | Fetches the third page, showing 25 results. |
| **Search** | `/api/customers?query=jane%20doe` | Searches for customers matching "jane doe" (default page/limit). |
| **Combined** | `/api/customers?page=2&limit=5&query=smith` | Fetches the second page of 5 results, filtered by "smith". |

#### **Example Response Structure (Expected)**

While the exact structure depends on your `getCustomersWithPropertyCount` function, a typical successful response would look like this:

```json
{
  "customers": [
    {
      "id": "cust_123",
      "name": "Jane Smith",
      "email": "jane@example.com",
      "propertyCount": 3
    }
    // ... more customer objects
  ],
  "currentPage": 2,
  "totalPages": 10,
  "totalCustomers": 100
}
```
