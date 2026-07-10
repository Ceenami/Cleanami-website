## API Endpoint: Geocoding Management and Status

-----

### 🚀 Overview

This Next.js API route provides two main functionalities:

1.  **`POST`**: **Triggering bulk geocoding** of addresses for cleaners and/or properties using a Google Maps service. This is restricted to users with `admin` or `super_admin` roles.
2.  **`GET`**: **Checking the current geocoding status**, showing the total, geocoded, and remaining records for both cleaners and properties.

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/geocoding` (Assuming a common REST structure) | Starts the bulk geocoding process for a specified target (`cleaners`, `properties`, or `all`). |
| `GET` | `/api/geocoding` (Assuming a common REST structure) | Retrieves a summary of geocoding completeness for cleaners and properties. |

-----

## 📝 `GET` Handler: Geocoding Status Check

This function provides the current statistics on which records have already been geocoded.

### Logic Breakdown

1.  **Dynamic Imports**: Imports the necessary database (`@/db`) and schema (`@/db/schemas`) modules, as well as the `isNull` utility from Drizzle ORM.
2.  **Parallel Database Queries**: It uses `Promise.all` to efficiently run four separate queries concurrently:
      * **Cleaners without Coordinates**: Finds records where `cleaners.latitude` is `NULL`.
      * **Properties without Coordinates**: Finds records where `properties.latitude` is `NULL`.
      * **All Cleaners**: Fetches all cleaner records to get the total count and check their existing latitude status.
      * **All Properties**: Fetches all property records for total count and latitude status.
3.  **Calculate and Respond**: The results from the four queries are aggregated to calculate:
      * `total`: The total number of records (e.g., `cleanersWithCoords.length`).
      * `geocoded`: The number of records with a valid latitude value (e.g., `filter(c => c.latitude).length`).
      * `remaining`: The number of records without coordinates (e.g., `cleanersWithoutCoords.length`).
4.  **Error Handling**: If any database or query error occurs, it returns an **HTTP 500** response.

### 💡 How to Use (`GET`)

**Request:**

```bash
GET /api/geocoding
```

**Example Successful Response:**

```json
{
  "cleaners": {
    "total": 50,
    "geocoded": 48,
    "remaining": 2
  },
  "properties": {
    "total": 120,
    "geocoded": 100,
    "remaining": 20
  }
}
```

-----

## 📝 `POST` Handler: Trigger Bulk Geocoding

This function initiates the resource-intensive process of converting addresses to geographical coordinates.

### 🔐 Authentication and Authorization

1.  **Supabase Client**: Initializes a server-side Supabase client (`createClient()`).
2.  **User Claims Check**: Retrieves the current user's claims using `supabase.auth.getClaims()`.
3.  **Role Restriction**: It checks the user's role (`userRole`).
      * **🛑 Unauthorized**: If the role is *not* `admin` or `super_admin`, it immediately returns an **HTTP 401 (Unauthorized)** error.

### Logic Breakdown

1.  **Extract Target**: It reads the `target` parameter from the request body, which must be `'cleaners'`, `'properties'`, or `'all'`.
2.  **Initialize Results**: A `results` object is created to track the progress and final counts.
3.  **Conditional Geocoding**:
      * **Cleaners**: If `target` is `'cleaners'` or `'all'`, it calls `geocodeAllCleaners`. This function accepts a **callback** to report progress (`current`, `total`), which is logged to the server console.
      * **Properties**: If `target` is `'properties'` or `'all'`, it calls `geocodeAllProperties`, similarly logging progress.
4.  **Final Response**: Returns a JSON response summarizing the total number of items processed.

### 💡 How to Use (`POST`)

You must be authenticated as an `admin` or `super_admin` to execute this request.

**Request (To geocode only properties):**

```bash
POST /api/geocoding
Content-Type: application/json

{
    "target": "properties"
}
```

**Request (To geocode all resources):**

```bash
POST /api/geocoding
Content-Type: application/json

{
    "target": "all"
}
```

**Example Successful Response:**

```json
{
  "success": true,
  "results": {
    "cleaners": {
      "geocoded": 50,
      "total": 50
    },
    "properties": {
      "geocoded": 120,
      "total": 120
    }
  },
  "message": "Geocoding complete"
}
```

**Example Error Response (Authorization):**

```json
{
  "error": "Unauthorized"
}
```

**(Status Code: 401)**