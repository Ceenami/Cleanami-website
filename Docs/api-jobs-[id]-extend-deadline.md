## API Endpoint: Extend Job Deadline (POST)

-----

### 🚀 Overview

This Next.js API route handles a **`POST`** request to modify the scheduled deadline for a specific job. It requires the caller to be an administrator and expects a new deadline timestamp in the request body. The value is used to update the `checkInTime` field in the database, effectively establishing the new required start time.

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/jobs/[id]/deadline` (Assuming this structure) | Updates the deadline (`checkInTime`) for the job specified by `[id]`. |

-----

### 🛠️ Implementation Details

#### **File Location**

This code snippet is likely part of a file named `route.ts` within a dynamic route specific to job actions, such as:

```
app/api/jobs/[id]/deadline/route.ts
```

#### **Dependencies**

| Import | Source | Purpose |
| :--- | :--- | :--- |
| `db` | `  "@/db" ` | The Drizzle database connection instance. |
| `jobs` | `  "@/db/schemas" ` | The Drizzle schema definition for the `jobs` table. |
| `eq` | `  "drizzle-orm" ` | Drizzle ORM utility for equality comparison. |
| `createClient` | `  "@/lib/supabase/server" ` | Utility to create a server-side Supabase client for authentication. |
| `NextRequest`, `NextResponse` | `  "next/server" ` | Next.js utilities for handling requests and crafting responses. |

-----

### 📝 `POST` Handler Function (`POST`)

This function executes the deadline update operation.

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

2.  **Extract Parameters and Body:**

    ```typescript
    const { id } = await params;
    const { newDeadline } = await request.json();
    ```

      * Extracts the **Job ID** (`id`) from the dynamic route.
      * Extracts the required **`newDeadline`** value from the JSON request body.

3.  **Input Validation:**

    ```typescript
    if (!newDeadline) {
      return NextResponse.json(
        { error: "New deadline is required" },
        { status: 400 }
      );
    }
    ```

      * Returns an **HTTP 400 (Bad Request)** if the `newDeadline` is missing from the request body.

4.  **Database Update:**

    ```typescript
    await db
      .update(jobs)
      .set({
        checkInTime: new Date(newDeadline),
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, id));
    ```

      * Updates the `jobs` table for the specified `id`.
      * **Note**: The `newDeadline` string is converted to a `Date` object and stored in the **`checkInTime`** column. This column is being used here to represent the job's scheduling deadline.
      * The `updatedAt` timestamp is also refreshed.

5.  **Response:**

      * Returns a simple JSON response indicating success.

6.  **Error Handling:**

      * Catches general errors (e.g., database failure, invalid date format) and returns an **HTTP 500 (Internal Server Error)**.

-----

### 💡 How to Use (Client-Side Example)

A client sends the new deadline as a string (ideally an ISO 8601 format string which the `new Date()` constructor can parse reliably) in the request body.

#### **Request**

To set the deadline for job `JOB_D456` to October 15, 2025, at 10:00 AM UTC:

```bash
POST /api/jobs/JOB_D456/deadline
Content-Type: application/json
Authorization: Bearer <ADMIN_TOKEN>

{
    "newDeadline": "2025-10-15T10:00:00.000Z"
}
```

#### **Response**

```json
{
  "success": true
}
```