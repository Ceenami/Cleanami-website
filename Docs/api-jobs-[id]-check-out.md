## API Endpoint: Job Check-Out (Finish Work)

-----

### 🚀 Overview

This Next.js API route handles a **`POST`** request to finalize and mark a specific job as **completed**. The operation involves two key, sequential database updates:

1.  Setting the job's final status to `'completed'` and recording the `checkOutTime`.
2.  Recording the final GPS timestamp in the job's corresponding `evidencePacket`.

Access to this endpoint is restricted to authorized administrative users.

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/jobs/[id]/check-out` (Assuming this structure) | Finalizes the job specified by `[id]`, changes its status to 'completed', and records the check-out time. |

-----

### 🛠️ Implementation Details

#### **File Location**

This code snippet is likely part of a file named `route.ts` within a dynamic route specific to job actions, such as:

```
app/api/jobs/[id]/check-out/route.ts
```

#### **Dependencies**

| Import | Source | Purpose |
| :--- | :--- | :--- |
| `db` | `  "@/db" ` | The Drizzle database connection instance. |
| `jobs`, `evidencePackets` | `  "@/db/schemas" ` | The Drizzle schema definitions for the affected tables. |
| `eq` | `  "drizzle-orm" ` | Drizzle ORM utility for equality comparison. |
| `createClient` | `  "@/lib/supabase/server" ` | Utility to create a server-side Supabase client for authentication. |
| `NextRequest`, `NextResponse` | `  "next/server" ` | Next.js utilities for handling requests and crafting responses. |

-----

### 📝 `POST` Handler Function (`POST`)

This function executes the job check-out operation.

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

3.  **Database Operation 1: Update Job Status (Primary Record):**

    ```typescript
    await db
      .update(jobs)
      .set({
        status: "completed",
        checkOutTime: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, id));
    ```

      * The `jobs` table is updated.
      * The `status` is set to `"completed"`.
      * The final `checkOutTime` and the `updatedAt` timestamps are recorded.

4.  **Database Operation 2: Update Evidence Packet (Audit Trail):**

    ```typescript
    await db
      .update(evidencePackets)
      .set({
        gpsCheckOutTimestamp: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(evidencePackets.jobId, id));
    ```

      * The `evidencePackets` table is updated to record the final `gpsCheckOutTimestamp`, which is often critical for audit and payroll purposes.

5.  **Response:**

      * Returns a simple JSON response indicating success.

6.  **Error Handling:**

      * Catches any errors during the process (e.g., database connection failure) and returns an **HTTP 500 (Internal Server Error)**.

-----

### 💡 How to Use (Client-Side Example)

This endpoint is typically triggered when the job is verified as complete, or when the primary cleaner officially clocks out.

#### **Request**

To check out from the job with ID `JOB_Z987`:

```bash
POST /api/jobs/JOB_Z987/check-out
```

*(No request body is needed, but valid authorization headers are mandatory.)*

#### **Response**

```json
{
  "success": true
}
```