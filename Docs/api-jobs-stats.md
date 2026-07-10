## API Endpoint: Retrieve Job Statistics (GET)

-----

### 🚀 Overview

This Next.js API route handles a **`GET`** request to retrieve high-level statistics related to all jobs in the system. It's intended to feed a dashboard or reporting tool with critical aggregated data (e.g., total jobs, jobs by status, completion rates). Access is restricted to users with administrative privileges.

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/stats/jobs` (Assuming a common REST structure) | Retrieves aggregated data and metrics about job performance and status. |

-----

### 🛠️ Implementation Details

#### **File Location**

This code snippet is likely part of a file named `route.ts` within a stats API folder, such as:

```
app/api/stats/jobs/route.ts
```

#### **Dependencies**

| Import | Source | Purpose |
| :--- | :--- | :--- |
| `getJobStats` | `  "@/lib/queries/stats" ` | The core service function responsible for querying the database and calculating/aggregating job statistics. |
| `createClient` | `  "@/lib/supabase/server" ` | Utility to create a server-side Supabase client for authentication. |
| `NextResponse` | `  "next/server" ` | Next.js utility for crafting responses. |

-----

### 📝 `GET` Handler Function (`GET`)

This function executes the authorized retrieval of job statistics.

#### **Signature**

```typescript
export async function GET()
```

#### **Logic Breakdown**

1.  **Authentication and Authorization:**

    ```typescript
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const userRole = user?.user_metadata?.role;

    if (userRole !== "admin" || userRole !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    ```

      * It checks the authenticated user's role via **Supabase claims**.
      * **Authorization**: Access is strictly restricted to users with the **`admin`** or **`super_admin`** role. If unauthorized, it returns an **HTTP 401 (Unauthorized)**.

2.  **Fetch Data from Service Layer:**

    ```typescript
    const stats = await getJobStats();
    ```

      * It calls the dedicated service function, `getJobStats()`. This function performs all necessary database queries (e.g., aggregation functions, counts) to produce the final statistical object.

3.  **Successful Response:**

    ```typescript
    return NextResponse.json(stats);
    ```

      * Returns the aggregated statistics object as a JSON response.

4.  **Error Handling (Try-Catch):**

      * Catches any errors (e.g., database connection failure, query errors) and returns an **HTTP 500 (Internal Server Error)** with a generic failure message.

-----

### 💡 How to Use (Client-Side Example)

This endpoint is typically called by administrative dashboards.

#### **Request**

```bash
GET /api/stats/jobs
Authorization: Bearer <ADMIN_TOKEN>
```
