## API Endpoint: Update Cleaner Details (PATCH)

-----

### 🚀 Overview

This Next.js API route handles `PATCH` requests to update a specific cleaner's details in the database. It uses **Drizzle ORM** for the database operation.

A notable feature is that if the `address` field is updated in the request body, it triggers a call to an external service (likely **Google Maps Geocoding**) to update the cleaner's geographical coordinates.

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `PATCH` | `/api/cleaners/[id]` (Assuming a common REST structure) | Updates fields for a specific cleaner. |

-----

### 🛠️ Implementation Details

#### **File Location**

This code snippet is likely part of a file named `route.ts` within a dynamic route, such as:

```
app/api/cleaners/[id]/route.ts
```

#### **Dependencies**

The route relies on the following imports:

| Import | Source | Purpose |
| :--- | :--- | :--- |
| `db` | `  "@/db" ` | The Drizzle database connection instance. |
| `cleaners` | `  "@/db/schemas" ` | The Drizzle schema definition for the `cleaners` table. |
| `updateCleanerCoordinates` | `  "@/lib/services/google-maps/geocoding" ` | A service function to geocode the cleaner's address and update coordinates. |
| `eq` | `  "drizzle-orm" ` | A Drizzle ORM utility for creating an equality condition in the `WHERE` clause. |
| `NextResponse` | `  "next/server" ` | Used to return a standardized JSON response. |

-----

### 📝 `PATCH` Handler Function (`PATCH`)

This function executes the update operation.

#### **Signature**

```typescript
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> })
```

#### **Logic Breakdown**

1.  **Extract Parameters and Body:**

    ```typescript
    const { id } = await params;
    const body = await req.json();
    ```

      * It safely extracts the **cleaner's ID** (`id`) from the dynamic route parameters.
      * It parses the **request body** (`body`), which contains the fields to be updated.

2.  **Database Update:**

    ```typescript
    await db.update(cleaners).set(body).where(eq(cleaners.id, id));
    ```

      * This is the primary database operation.
      * It updates the `cleaners` table (`db.update(cleaners)`).
      * It applies the fields from the request body (`.set(body)`).
      * It uses the cleaner's ID to target the correct row (`.where(eq(cleaners.id, id))`).

3.  **Coordinate Geocoding (Conditional):**

    ```typescript
    if (body.address) {
      await updateCleanerCoordinates(id);
    }
    ```

      * **Crucial Step:** If the request body includes an `address` field (meaning the address was updated), the `updateCleanerCoordinates` service is called.
      * This function uses the cleaner's `id` to fetch the newly updated address and persist the corresponding latitude and longitude coordinates back to the database.

4.  **Response:**

    ```typescript
    return NextResponse.json({ success: true });
    ```

      * It returns a simple JSON response indicating the operation was successful.

-----

### 💡 How to Use (Client-Side Example)

A client (e.g., a React component or an external API consumer) would send a `PATCH` request to the endpoint with the new data in the body.

#### **Request**

```bash
PATCH /api/cleaners/CLNR_12345
Content-Type: application/json

{
    "phone": "555-123-4567",
    "address": "123 New Street, New City" 
    // Only include the fields you want to change
}
```

#### **Response**

```json
{
    "success": true
}
```
