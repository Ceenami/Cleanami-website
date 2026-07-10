## API Endpoint: Retrieve Filtered Job List (GET)

-----

### 🚀 Overview

This Next.js API route handles a **`GET`** request to retrieve a filtered and paginated list of jobs, complete with associated details (e.g., properties, cleaners). It serves as a comprehensive backend for a job management dashboard or list view.

The endpoint supports five filtering parameters:

1.  **Pagination** (`page`, `limit`)
2.  **Status Filtering** (`status`)
3.  **Search Query** (`query`)
4.  **Date Range Filtering** (`startDate`, `endDate`)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/jobs` (Assuming this structure) | Retrieves a paginated list of jobs, supporting various filters. |

-----

### 🛠️ Implementation Details

#### **File Location**

This code snippet is likely part of a file named `route.ts` within the main jobs API folder, such as:

```
app/api/jobs/route.ts
```

#### **Dependencies**

| Import | Source | Purpose |
| :--- | :--- | :--- |
| `getJobsWithDetails` | `  "@/lib/queries/jobs" ` | The core service function that handles all filtering, pagination, and database joins. |
| `createClient` | `  "@/lib/supabase/server" ` | Utility to create a server-side Supabase client for authentication. |
| `NextRequest`, `NextResponse` | `  "next/server" ` | Next.js utilities for handling requests and crafting responses. |

-----

### 📝 `GET` Handler Function (`GET`)

This function executes the authorized and filtered job list retrieval.

#### **Signature**

```typescript
export async function GET(request: NextRequest)
```

#### **Logic Breakdown**

1.  **Authentication and Authorization:**

    ```typescript
    // ... check user role
    if (userRole !== "admin" || userRole !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    ```

      * It checks the authenticated user's role via **Supabase claims**.
      * **Authorization**: Access is strictly restricted to users with the **`admin`** or **`super_admin`** role. If unauthorized, it returns an **HTTP 401 (Unauthorized)**.

2.  **Extract and Parse Query Parameters:**

      * **Pagination:** `page` defaults to `1` and `limit` defaults to `10`.
      * **Filtering:** `status` defaults to `"all"`. `query` defaults to an empty string.
      * **Date Filtering:** `startDate` and `endDate` are parsed as JavaScript `Date` objects if provided in the URL; otherwise, they are `undefined`.

3.  **Fetch Data from Service Layer:**

    ```typescript
    const result = await getJobsWithDetails({
      page,
      limit,
      status,
      query,
      startDate,
      endDate,
    });
    ```

      * All parsed parameters are packaged and passed to the `getJobsWithDetails` function, which performs the database query using these filters.

4.  **Successful Response:**

      * Returns the `result` object (containing the job list and likely pagination metadata) as a JSON response.

5.  **Error Handling (Try-Catch):**

      * Catches any errors (e.g., database connection failure, invalid date formats) and returns an **HTTP 500 (Internal Server Error)**.

-----

### 💡 How to Use (Client-Side Examples)

The client uses URL query parameters to control the list returned by the API. Dates should ideally be sent as ISO 8601 strings (e.g., `YYYY-MM-DD`).

| Action | URL Example | Description |
| :--- | :--- | :--- |
| **Default Fetch** | `/api/jobs` | Fetches the first page (10 jobs) with no specific filter. |
| **Filter by Status** | `/api/jobs?status=completed&limit=25` | Fetches 25 jobs from the first page that have a status of `"completed"`. |
| **Search & Paginate** | `/api/jobs?query=roof&page=3` | Searches for "roof" (likely in the property address or job notes) on the third page. |
| **Date Range Filter** | `/api/jobs?startDate=2025-01-01&endDate=2025-01-31` | Fetches jobs scheduled within the month of January 2025 (default page/limit). |

#### **Example Response Structure (Expected)**

```json
{
  "jobs": [
    {
      "id": "job_123",
      "status": "assigned",
      "propertyAddress": "456 Oak Lane",
      "cleanerName": "Alice"
      // ... more job details
    }
    // ... more job objects
  ],
  "currentPage": 1,
  "totalPages": 5,
  "totalJobs": 50
}
```