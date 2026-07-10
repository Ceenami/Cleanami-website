## API Endpoint: Find Available Cleaners by Job Proximity

-----

### 🚀 Overview

This Next.js API route handles `GET` requests to find cleaners who are located within a certain radius of a specified job's property address. The core logic handles authentication, customizable search options, and error handling for cases like unauthorized access or a job not being found.

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/jobs/[id]/available-cleaners` (Assuming this structure) | Retrieves a list of cleaners available for the job specified by `[id]`, filtered by distance and availability. |

-----

### 🛠️ Implementation Details

#### **File Location**

This code snippet is likely part of a file named `route.ts` within a dynamic route under a jobs structure, such as:

```
app/api/jobs/[id]/available-cleaners/route.ts
```

#### **Dependencies**

| Import | Source | Purpose |
| :--- | :--- | :--- |
| `getAvailableCleanersForJob` | `  "@/lib/queries/cleaners-proximity" ` | The core service function that performs the proximity-based database query. |
| `createClient` | `  "@/lib/supabase/server" ` | Utility to create a server-side Supabase client for authentication. |
| `NextRequest`, `NextResponse` | `  "next/server" ` | Next.js utilities for handling requests and responses. |

#### **Constants**

```typescript
const SERVICE_RADIUS_MILES = 25;
```

  * Defines the **default search radius** in miles if the client does not specify one via query parameters.

-----

### 📝 `GET` Handler Function (`GET`)

This function executes the authorized search for available cleaners.

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

      * It uses a server-side Supabase client to retrieve the current user's claims and role.
      * **Crucially**, it enforces access control, allowing the operation only if the user's role is `admin` or `super_admin`.

2.  **Extract Parameters:**

    ```typescript
    const { id } = await params;
    // ... parse radiusMiles and includeOnJob
    ```

      * It extracts the **Job ID** (`id`) from the dynamic route parameters.

3.  **Parse Query Parameters (Options):**

      * `radiusMiles`: Safely parses the `radius` query parameter as an integer. Defaults to `SERVICE_RADIUS_MILES` (25) if not provided.
      * `includeOnJob`: Checks the `includeOnJob` query parameter. If it is explicitly set to `"false"`, the value is `false`; otherwise, it defaults to `true`. This flag controls whether cleaners currently assigned to another job are included in the results.

4.  **Fetch Available Cleaners:**

    ```typescript
    const result = await getAvailableCleanersForJob(id, {
      radiusMiles,
      includeOnJob,
    });
    ```

      * It calls the database service function, passing the Job ID and the search options. This function is responsible for the geospatial query (e.g., using a distance calculation in the database).

5.  **Successful Response:**

      * Returns a JSON object containing the list of filtered `cleaners`, the `radiusMiles` used for the search, and the `propertyAddress` of the job.

6.  **Error Handling (Try-Catch):**

      * It includes specific handling for "not found" errors (e.g., if the Job ID doesn't exist), returning an **HTTP 404 (Not Found)** status.
      * Other failures result in an **HTTP 500 (Internal Server Error)** response.

-----

### 💡 How to Use (Client-Side Example)

A client can customize the search using query parameters:

| Parameter | Type | Default Value | Description |
| :--- | :--- | :--- | :--- |
| `radius` | `number` | `25` | Overrides the default search radius (in miles) around the job's property. |
| `includeOnJob` | `boolean` | `true` | Set to `false` to exclude cleaners who are currently assigned to another job. |

#### **Request Examples**

| Action | URL Example | Description |
| :--- | :--- | :--- |
| **Default Search** | `/api/jobs/JOB_A1/cleaners` | Finds available cleaners within 25 miles, including those on other jobs. |
| **Narrow Search** | `/api/jobs/JOB_A1/cleaners?radius=10` | Finds cleaners within 10 miles (default availability filter). |
| **Filter by Availability** | `/api/jobs/JOB_A1/cleaners?includeOnJob=false` | Finds cleaners within 25 miles who are *not* currently assigned to another job. |

#### **Example Successful Response Structure**

```json
{
  "cleaners": [
    {
      "id": "cln_456",
      "name": "Alex Johnson",
      "distanceMiles": 5.2,
      "currentStatus": "Available"
      // ... other cleaner details
    }
    // ... more cleaners
  ],
  "radiusMiles": 25,
  "propertyAddress": "123 Main St, Anytown"
}
```