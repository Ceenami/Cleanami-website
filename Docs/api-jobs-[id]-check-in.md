## API Endpoint: Job Check-In (Start Work)

-----

### 🚀 Overview

This Next.js API route handles a **`POST`** request to officially mark a job as **started** by the primary cleaner. It executes several critical, interdependent database updates within a **transaction** to guarantee data integrity.

The process involves:

1.  **Authorization** check.
2.  Identifying the **primary cleaner** for the job.
3.  Updating the job **status** to 'in-progress'.
4.  Recording the official **check-in time**.
5.  Updating the primary cleaner's **on-call status** to 'on\_job'.

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/jobs/[id]/check-in` (Assuming this structure) | Initiates the job by updating statuses and timestamps, and requires the caller to be an administrator. |

-----

### 🛠️ Implementation Details

#### **File Location**

This code snippet is likely part of a file named `route.ts` within a dynamic route specific to job actions, such as:

```
app/api/jobs/[id]/check-in/route.ts
```

#### **Dependencies**

| Import | Source | Purpose |
| :--- | :--- | :--- |
| `db` | `  "@/db" ` | The Drizzle database connection instance. |
| `jobs`, `cleaners`, `jobsToCleaners`, `evidencePackets` | `  "@/db/schemas" ` | The Drizzle schema definitions for all affected tables. |
| `eq` | `  "drizzle-orm" ` | Drizzle ORM utility for equality comparison. |
| `createClient` | `  "@/lib/supabase/server" ` | Utility to create a server-side Supabase client for authentication. |
| `NextResponse` | `  "next/server" ` | Next.js utilities for crafting responses. |

-----

### 📝 `POST` Handler Function (`POST`)

This function executes the job check-in process within a safe database transaction.

#### **Signature**

```typescript
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
)
```

#### **Logic Breakdown**

1.  **Authentication and Authorization:**

      * Checks the authenticated user's role via Supabase claims.
      * **Authorization**: The operation is strictly limited to users with the `admin` or `super_admin` role. Returns **HTTP 401** if unauthorized.

2.  **Parameter Validation:**

      * Extracts the `jobId` from the route parameters.
      * Returns **HTTP 400 (Bad Request)** if the `jobId` is missing.

3.  **Database Transaction (`db.transaction`):**
    The core logic is wrapped in a Drizzle transaction to ensure all four database steps succeed or fail together.

      * **Step 1: Find Primary Cleaner**

          * Queries the `jobsToCleaners` table for the entry associated with the `jobId` and where the `role` is `'primary'`.
          * If no primary cleaner is found, the transaction is **rolled back**, and an error is thrown.

      * **Step 2: Update Job Status**

          * Updates the `jobs` table, setting the `status` to `"in-progress"`, and recording the current time in `checkInTime` and `updatedAt`.

      * **Step 3: Update Evidence Packet**

          * Updates the `evidencePackets` table for the job, recording the current time in `gpsCheckInTimestamp` and `updatedAt`.

      * **Step 4: Update Cleaner Status**

          * Updates the `cleaners` table for the identified primary cleaner, setting their `onCallStatus` to `"on_job"`.

4.  **Successful Response:**

      * Returns a simple JSON response indicating the transaction was successful.

5.  **Error Handling:**

      * Catches errors from the transaction (including the explicit "No primary cleaner found" error) and returns an **HTTP 500 (Internal Server Error)** with a descriptive error message.

-----

### 💡 How to Use (Client-Side Example)

This endpoint is typically triggered when the primary cleaner arrives at the job site and initiates the work.

#### **Request**

To check in for the job with ID `JOB_Y234`:

```bash
POST /api/jobs/JOB_Y234/check-in
```

*(No request body is needed, but valid authorization headers are required.)*

#### **Response**

**Success:**

```json
{
  "success": true
}
```

**Failure (No Primary Cleaner):**

```json
{
  "error": "Failed to check in: No primary cleaner found for this job."
}
```

**(Status Code: 500)**