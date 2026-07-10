## API Endpoint: Retrieve Filtered Property List (GET)

-----

### 🚀 Overview

This Next.js API route handles a **`GET`** request to retrieve a paginated and searchable list of properties. Crucially, the data retrieval function, `getPropertiesWithOwner`, ensures that the owner's information is joined with each property record. Access to this management endpoint is restricted to authorized administrative users.

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/properties` (Assuming this structure) | Retrieves a paginated and searchable list of properties, including owner details. |

-----

### 🛠️ Implementation Details

#### **File Location**

This code snippet is likely part of a file named `route.ts` within the main properties API folder, such as:

```
app/api/properties/route.ts
```

#### **Dependencies**

| Import | Source | Purpose |
| :--- | :--- | :--- |
| `getPropertiesWithOwner` | `  "@/lib/queries/properties" ` | The core service function that handles filtering, pagination, and joins property data with owner data. |
| `createClient` | `  "@/lib/supabase/server" ` | Utility to create a server-side Supabase client for authentication. |
| `NextRequest`, `NextResponse` | `  "next/server" ` | Next.js utilities for handling requests and crafting responses. |

-----

### 📝 `GET` Handler Function (`GET`)

This function executes the authorized and filtered property list retrieval.

#### **Signature**

```typescript
export async function GET(request: NextRequest)
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

      * It checks the authenticated user's role via **Supabase claims**.
      * **Authorization**: Access is strictly restricted to users with the **`admin`** or **`super_admin`** role. If unauthorized, it returns an **HTTP 401 (Unauthorized)**.

2.  **Extract and Parse Query Parameters:**

    ```typescript
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "10");
    const query = searchParams.get("query") || "";
    ```

      * **Pagination:** `page` defaults to `1` and `limit` defaults to `10`.
      * **Searching:** `query` defaults to an empty string, allowing for searching across property addresses, notes, or owner names (depending on the `getPropertiesWithOwner` implementation).

3.  **Fetch Data from Service Layer:**

    ```typescript
    const result = await getPropertiesWithOwner({ page, limit, query });
    ```

      * The parsed parameters are passed to the `getPropertiesWithOwner` function to execute the database query.

4.  **Successful Response:**

      * Returns the `result` object (containing the property list and likely pagination metadata) as a JSON response.

5.  **Error Handling (Try-Catch):**

      * Catches any errors (e.g., database connection failure, query errors) and returns an **HTTP 500 (Internal Server Error)**.

-----

### 💡 How to Use (Client-Side Examples)

The client uses URL query parameters to control the list returned by the API.

| Action | URL Example | Description |
| :--- | :--- | :--- |
| **Default Fetch** | `/api/properties` | Fetches the first page (10 properties) with no search filter. |
| **Pagination** | `/api/properties?page=3&limit=20` | Fetches the third page, showing 20 properties per page. |
| **Search** | `/api/properties?query=apartment` | Searches for properties matching "apartment" (default page/limit). |

#### **Example Response Structure (Expected)**

```json
{
  "properties": [
    {
      "id": "prop_101",
      "address": "123 Main St",
      "city": "Springfield",
      "owner": {
        "id": "cust_500",
        "name": "Homer Simpson",
        "email": "homer@example.com"
      }
      // ... more property details
    }
    // ... more property objects
  ],
  "currentPage": 1,
  "totalPages": 8,
  "totalProperties": 80
}
```