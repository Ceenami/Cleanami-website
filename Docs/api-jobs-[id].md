## API Endpoint: Retrieve Single Job Details (GET)

-----

### 🚀 Overview

This Next.js API route handles a **`GET`** request to fetch comprehensive details for a specific job, identified by its ID. It relies on a separate service function, `getJobDetails`, to perform the complex data retrieval (likely involving joins across multiple tables). Access to this endpoint is strictly limited to administrative users.

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/jobs/[id]` (Assuming this structure) | Retrieves all data fields, associations, and related details for the job specified by `[id]`. |

-----

### 🛠️ Implementation Details

#### **File Location**

This code snippet is likely part of a file named `route.ts` within a dynamic route under the jobs API folder, such as:

```
app/api/jobs/[id]/route.ts
```

#### **Dependencies**

| Import | Source | Purpose |
| :--- | :--- | :--- |
| `getJobDetails` | `  "@/lib/queries/jobs" ` | The core service function that performs the database query to fetch all relevant job information. |
| `createClient` | `  "@/lib/supabase/server" ` | Utility to create a server-side Supabase client for authentication. |
| `NextRequest`, `NextResponse` | `  "next/server" ` | Next.js utilities for handling requests and crafting responses. |

-----

### 📝 `GET` Handler Function (`GET`)

This function executes the authorized retrieval of job details.

#### **Signature**

```typescript
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
)
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

2.  **Extract Job ID and Fetch Data:**

    ```typescript
    const { id } = await params;
    const job = await getJobDetails(id);
    ```

      * Extracts the **Job ID** (`id`) from the dynamic route parameters.
      * Calls the dedicated service function, `getJobDetails(id)`, which handles the database query and data shaping.

3.  **Successful Response:**

    ```typescript
    return NextResponse.json(job);
    ```

      * Returns the complete job object retrieved from the service layer as a JSON response. If the job is not found, the service layer is expected to handle it (e.g., return `null`), resulting in a 200 response with empty or null data, or the error handling block will catch it.

4.  **Error Handling (Try-Catch):**

      * Catches any errors (e.g., database connection failure, query errors) and returns an **HTTP 500 (Internal Server Error)** with a generic failure message.

-----

### 💡 How to Use (Client-Side Example)

This endpoint is typically used by administrative interfaces to view a job's profile or management screen.

#### **Request**

To fetch details for the job with ID `JOB_PQR`:

```bash
GET /api/jobs/JOB_PQR
Authorization: Bearer <ADMIN_TOKEN>
```

#### **Example Successful Response Structure**

The exact structure depends on `getJobDetails`, but would typically include:

```json
{
  "id": "JOB_PQR",
  "status": "assigned",
  "property": {
    "id": "prop_101",
    "address": "123 Maple St"
  },
  "customer": {
    "id": "cust_500",
    "name": "Jane Doe"
  },
  "cleaners": [
    {
      "id": "clnr_007",
      "name": "James Bond",
      "role": "primary"
    }
  ],
  "checkInTime": "2025-10-20T08:00:00.000Z"
  // ... all other job fields
}
```