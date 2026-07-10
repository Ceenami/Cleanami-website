## API Endpoint: Reassign Primary Cleaner (POST)

-----

### 🚀 Overview

This Next.js API route handles a **`POST`** request to change the **primary cleaner** assigned to a specific job. The operation is designed to ensure a job has only one primary cleaner at a time by first deleting any existing primary assignment for that job, then creating the new assignment, and finally updating the job's status.

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/jobs/[id]/reassign` (Assuming this structure) | Assigns a new primary cleaner to the job specified by `[id]`, replacing any existing primary cleaner. |

-----

### 🛠️ Implementation Details

#### **File Location**

This code snippet is likely part of a file named `route.ts` within a dynamic route specific to job actions, such as:

```
app/api/jobs/[id]/reassign/route.ts
```

#### **Dependencies**

| Import | Source | Purpose |
| :--- | :--- | :--- |
| `db` | `  "@/db" ` | The Drizzle database connection instance. |
| `jobs`, `jobsToCleaners` | `  "@/db/schemas" ` | The Drizzle schema definitions for the `jobs` table and the many-to-many assignment table. |
| `eq`, `and` | `  "drizzle-orm" ` | Drizzle ORM utilities for creating equality and logical AND conditions. |
| `createClient` | `  "@/lib/supabase/server" ` | Utility to create a server-side Supabase client for authentication. |
| `NextRequest`, `NextResponse` | `  "next/server" ` | Next.js utilities for handling requests and crafting responses. |

-----

### 📝 `POST` Handler Function (`POST`)

This function executes the cleaner reassignment operation.

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
    const { cleanerId, role = "primary" } = await request.json();
    ```

      * Extracts the **Job ID** (`id`) from the dynamic route.
      * Extracts the required **`cleanerId`** and the optional **`role`** (defaults to `"primary"`) from the JSON request body.

3.  **Input Validation:**

      * Returns an **HTTP 400 (Bad Request)** if the required `cleanerId` is missing.

4.  **Database Operation 1: Remove Old Primary Cleaner:**

    ```typescript
    await db
      .delete(jobsToCleaners)
      .where(
        and(eq(jobsToCleaners.jobId, id), eq(jobsToCleaners.role, "primary"))
      );
    ```

      * Uses the `and` operator to specifically target and **delete** any existing assignment that matches both the current `jobId` and has the role of `"primary"`. This is the "reassign" step.

5.  **Database Operation 2: Assign New Cleaner:**

    ```typescript
    await db.insert(jobsToCleaners).values({
      jobId: id,
      cleanerId,
      role, // defaults to "primary"
    });
    ```

      * A new entry is created in the `jobsToCleaners` table, linking the job to the new cleaner with the specified role.

6.  **Database Operation 3: Update Job Status:**

    ```typescript
    await db
      .update(jobs)
      .set({
        status: "assigned",
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, id));
    ```

      * The job's status is updated to `"assigned"` to reflect the successful pairing with a cleaner.

7.  **Response:**

      * Returns a simple JSON response indicating success.

8.  **Error Handling:**

      * Catches general errors (e.g., database failure) and returns an **HTTP 500 (Internal Server Error)**.

-----

### 💡 How to Use (Client-Side Example)

A client sends the ID of the new cleaner in the request body.

#### **Request**

To reassign job `JOB_R789` to cleaner `CLNR_C007` as the primary cleaner:

```bash
POST /api/jobs/JOB_R789/reassign
Content-Type: application/json
Authorization: Bearer <ADMIN_TOKEN>

{
    "cleanerId": "CLNR_C007" 
    // "role" can be omitted as it defaults to "primary"
}
```

#### **Response**

```json
{
  "success": true
}
```