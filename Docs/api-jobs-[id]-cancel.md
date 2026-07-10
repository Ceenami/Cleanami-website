## API Endpoint: Cancel Job

-----

### 🚀 Overview

This Next.js API route handles a **`POST`** request to logically cancel a specific job. The operation involves two key database actions: updating the job's status to 'canceled' and unassigning all associated cleaners from the job. Access to this endpoint is restricted to authorized administrative users.

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/jobs/[id]/cancel` (Assuming this structure) | Cancels the job specified by `[id]`, changes its status, and removes all cleaner assignments. |

-----

### 🛠️ Implementation Details

#### **File Location**

This code snippet is likely part of a file named `route.ts` within a dynamic route specific to job actions, such as:

```
app/api/jobs/[id]/cancel/route.ts
```

#### **Dependencies**

| Import | Source | Purpose |
| :--- | :--- | :--- |
| `db` | `  "@/db" ` | The Drizzle database connection instance. |
| `jobs`, `jobsToCleaners` | `  "@/db/schemas" ` | The Drizzle schema definitions for the `jobs` table and the many-to-many relationship table. |
| `eq` | `  "drizzle-orm" ` | A Drizzle ORM utility for creating an equality condition in the `WHERE` clause. |
| `createClient` | `  "@/lib/supabase/server" ` | Utility to create a server-side Supabase client for authentication. |
| `NextRequest`, `NextResponse` | `  "next/server" ` | Next.js utilities for handling requests and crafting responses. |

-----

### 📝 `POST` Handler Function (`POST`)

This function executes the job cancellation operation.

#### **Signature**

```typescript
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
)
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

      * It checks the authenticated user's role via Supabase claims.
      * **Authorization**: The process is strictly restricted to users with the `admin` or `super_admin` role. If unauthorized, it returns an **HTTP 401 (Unauthorized)**.

2.  **Extract Job ID:**

    ```typescript
    const { id } = await params;
    ```

      * The **Job ID** (`id`) is extracted from the dynamic route parameters.

3.  **Database Operation 1: Unassign Cleaners (Cleanup):**

    ```typescript
    await db.delete(jobsToCleaners).where(eq(jobsToCleaners.jobId, id));
    ```

      * This crucial step **deletes** all entries in the `jobsToCleaners` table associated with the canceled job ID. This effectively unassigns all cleaners.

4.  **Database Operation 2: Update Job Status:**

    ```typescript
    await db
      .update(jobs)
      .set({
        status: "canceled",
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, id));
    ```

      * The `jobs` table is updated.
      * The `status` field is explicitly set to `"canceled"`.
      * The `updatedAt` timestamp is updated to the current time.

5.  **Response:**

      * Returns a simple JSON response indicating success.

6.  **Error Handling:**

      * Catches any errors during the process (e.g., database connection failure) and returns an **HTTP 500 (Internal Server Error)**.

-----

### 💡 How to Use (Client-Side Example)

This endpoint only requires the job ID in the URL and does not need a request body.

#### **Request**

To cancel the job with ID `JOB_X123`:

```bash
POST /api/jobs/JOB_X123/cancel
```

*(Note: Authentication headers must be included for this to pass the authorization check.)*

#### **Response**

```json
{
  "success": true
}
```