## API Endpoint: Retrieve Filtered Subscription List (GET)

-----

### 🚀 Overview

This Next.js API route handles a **`GET`** request to retrieve a filtered and paginated list of customer subscriptions. It's designed for administrative tools, providing essential details for managing billing and service agreements. The endpoint supports filtering by status, full-text searching, and pagination.

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/subscriptions` (Assuming this structure) | Retrieves a paginated list of subscriptions, supporting status and text filters. |

-----

### 🛠️ Implementation Details

#### **File Location**

This code snippet is likely part of a file named `route.ts` within the subscriptions API folder, such as:

```
app/api/subscriptions/route.ts
```

#### **Dependencies**

| Import | Source | Purpose |
| :--- | :--- | :--- |
| `getSubscriptionsWithDetails` | `  "@/lib/queries/subscriptions" ` | The core service function that handles all filtering, pagination, and database retrieval. |
| `createClient` | `  "@/lib/supabase/server" ` | Utility to create a server-side Supabase client for authentication. |
| `NextRequest`, `NextResponse` | `  "next/server" ` | Next.js utilities for handling requests and crafting responses. |

-----

### 📝 `GET` Handler Function (`GET`)

This function executes the authorized and filtered subscription list retrieval.

#### **Signature**

```typescript
export async function GET(request: NextRequest)
```

#### **Logic Breakdown**

1.  **Authentication and Authorization:**

    ```typescript
    const supabase = await createClient();
    // ... check user role
    if (userRole !== "admin" || userRole !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    ```

      * It checks the authenticated user's role via **Supabase claims**.
      * **Authorization**: Access is strictly restricted to users with the **`admin`** or **`super_admin`** role. If unauthorized, it returns an **HTTP 401 (Unauthorized)**.

2.  **Extract and Parse Query Parameters:**

      * **Pagination:** `page` defaults to `1` and `limit` defaults to `10`.
      * **Filtering:** `status` defaults to `"all"`. `query` defaults to an empty string, allowing for searching by customer name, plan, etc.

3.  **Fetch Data from Service Layer:**

    ```typescript
    const result = await getSubscriptionsWithDetails({
      page,
      limit,
      status,
      query,
    });
    ```

      * All parsed parameters are passed to the `getSubscriptionsWithDetails` function, which handles the database query and data aggregation (e.g., joining subscription data with customer names).

4.  **Successful Response:**

      * Returns the `result` object (containing the subscription list and pagination metadata) as a JSON response.

5.  **Error Handling (Try-Catch):**

      * Catches any errors (e.g., database connection failure) and returns an **HTTP 500 (Internal Server Error)**.

-----

### 💡 How to Use (Client-Side Examples)

The client uses URL query parameters to request a specific subset of subscriptions.

| Action | URL Example | Description |
| :--- | :--- | :--- |
| **Default Fetch** | `/api/subscriptions` | Fetches the first page (10 subscriptions) with no filters. |
| **Filter by Status** | `/api/subscriptions?status=active&limit=25` | Fetches 25 subscriptions from the first page that have an `"active"` status. |
| **Search & Paginate** | `/api/subscriptions?query=premium&page=3` | Searches for subscriptions matching "premium" on the third page. |

#### **Example Response Structure (Expected)**

```json
{
  "subscriptions": [
    {
      "id": "sub_101",
      "status": "active",
      "planName": "Premium Weekly",
      "startDate": "2024-05-01",
      "customerName": "John Doe"
      // ... more subscription details
    }
    // ... more subscription objects
  ],
  "currentPage": 1,
  "totalPages": 12,
  "totalSubscriptions": 120
}
```