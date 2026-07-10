## API Endpoint: Trigger Urgent Replacement (POST)

-----

### 🚀 Overview

This Next.js API route handles a **`POST`** request to flag a specific job as needing urgent, immediate reassignment. This action is used when an assigned cleaner is unavailable, and the job must be quickly redistributed to the pool of available cleaners.

The operation includes:

1.  **Unassigning** all currently linked cleaners.
2.  Setting the job's status to `'unassigned'`.
3.  **Flagging** the job with an `isUrgentBonus: true` to incentivize fast pickup.
4.  *(Planned)* Triggering a notification system to alert available cleaners.

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/jobs/[id]/urgent-replacement` (Assuming this structure) | Clears current assignments and flags the job as urgent for rapid reassignment. |

-----

### 🛠️ Implementation Details

#### **File Location**

This code snippet is likely part of a file named `route.ts` within a dynamic route specific to job actions, such as:

```
app/api/jobs/[id]/urgent-replacement/route.ts
```

#### **Dependencies**

| Import | Source | Purpose |
| :--- | :--- | :--- |
| `db` | `  "@/db" ` | The Drizzle database connection instance. |
| `jobs`, `jobsToCleaners` | `  "@/db/schemas" ` | The Drizzle schema definitions for the `jobs` table and the assignment table. |
| `eq` | `  "drizzle-orm" ` | Drizzle ORM utility for equality comparison. |
| `createClient` | `  "@/lib/supabase/server" ` | Utility to create a server-side Supabase client for authentication. |
| `NextRequest`, `NextResponse` | `  "next/server" ` | Next.js utilities for handling requests and crafting responses. |

-----

### 📝 `POST` Handler Function (`POST`)

This function executes the urgent replacement sequence.

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
    // ... check user role
    if (userRole !== "admin" || userRole !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    ```

      * The operation is strictly restricted to users with the **`admin`** or **`super_admin`** role. If unauthorized, it returns an **HTTP 401 (Unauthorized)**.

2.  **Extract Job ID:**

      * The **Job ID** (`id`) is extracted from the dynamic route parameters.

3.  **Database Operation 1: Unassign All Cleaners:**

    ```typescript
    await db.delete(jobsToCleaners).where(eq(jobsToCleaners.jobId, id));
    ```

      * All entries in the `jobsToCleaners` table associated with the job ID are **deleted**, ensuring the job is truly unassigned.

### This has been changed - outdated
4.  **Database Operation 2: Update Job Status and Flag:**

    ```typescript
    await db
      .update(jobs)
      .set({
        status: "unassigned",
        isUrgentBonus: true, // Flag for urgent incentive
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, id));
    ```

      * The job's `status` is set to **`"unassigned"`**.
      * The `isUrgentBonus` flag is set to **`true`**, which is typically used by the application logic to apply a premium or priority sorting when presenting the job to cleaners.

5.  **External Action (TODO):**

    ```typescript
    // TODO: Trigger notification to available cleaners
    ```

      * The code includes a placeholder comment indicating that a system for sending out notifications (e.g., SMS, push notification, email) to available cleaners should be integrated here, likely as an external service call.

6.  **Response:**

      * Returns a simple JSON response indicating success.

7.  **Error Handling:**

      * Catches general errors and returns an **HTTP 500 (Internal Server Error)**.

-----

### 💡 How to Use (Client-Side Example)

This endpoint is intended for administrative tools to quickly manage scheduling disruptions.

#### **Request**

To flag job `JOB_U123` for urgent replacement:

```bash
POST /api/jobs/JOB_U123/urgent-replacement
```

*(No request body is needed, but valid authorization headers are mandatory.)*

#### **Response**

```json
{
  "success": true
}
```