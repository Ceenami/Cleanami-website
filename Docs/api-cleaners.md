## Next.js API Route Documentation

This document describes the function and usage of the `/api/cleaners` Next.js API route, which handles fetching a paginated and searchable list of "cleaners" (presumably user accounts or service providers).

-----

## API Endpoint: `/api/cleaners`

| Method | Path | Description |
| :--- | :--- | :--- |
| **GET** | `/api/cleaners` | Retrieves a paginated list of cleaners, optionally filtered by a search query. |

-----

### 1\. Request Handling (GET)

The `GET` method handler processes incoming requests, extracts pagination and search parameters, and delegates the data retrieval to the backend logic.

#### A. Parameters

The endpoint accepts the following optional **query parameters**:

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `page` | `number` | `1` | The page number to fetch. Must be a positive integer. |
| `limit` | `number` | `15` | The maximum number of items per page. Must be a positive integer. |
| `query` | `string` | `''` (empty string) | A search term used to filter the list of cleaners. |

**Parameter Extraction Logic:**

  * The `page` and `limit` parameters are parsed as integers from the URL search parameters. If a parameter is missing or invalid, it defaults to **1** for `page` and **15** for `limit`.
  * The `query` parameter is taken as a string, defaulting to an empty string (`''`) if not provided.

#### B. Backend Data Fetching

The route relies on an external function to fetch the data:

  * **Function:** `getCleaners` (imported from `@/lib/queries/cleaners`)
  * **Invocation:** `await getCleaners({ page, limit, query })`
  * **Purpose:** This function is responsible for communicating with the database or data source to retrieve the list of cleaners based on the provided pagination and search criteria.

-----

### 2\. Response

The API route returns a JSON response containing the result of the data fetch or an error object.

#### A. Success Response (Status: `200 OK`)

If the data is fetched successfully, the response will be the direct result returned by the `getCleaners` function.

**Example Response Body:**

```json
{
  "data": [
    // Array of cleaner objects
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 5,
    "totalItems": 75,
    "itemsPerPage": 15
  }
}
```

*(Note: The exact structure of the response depends on the implementation of `getCleaners`.)*

#### B. Error Response (Status: `500 Internal Server Error`)

If an error occurs during the data fetching process (e.g., database connection failure, internal server error in `getCleaners`), the request is caught in the `catch` block.

  * An error message is logged to the server console via `console.error`.
  * The client receives a standardized error response.

**Example Response Body (on failure):**

```json
{
  "error": "Failed to fetch cleaners"
}
```

-----

### 3\. Usage Example (Client-side)

Example of how a client (e.g., a React component) might call this endpoint to get the second page with 20 items per page, filtered by the term "John":

```javascript
const page = 2;
const limit = 20;
const query = 'John';

fetch(`/api/cleaners?page=${page}&limit=${limit}&query=${query}`)
  .then(response => {
    if (!response.ok) {
      throw new Error('Network response was not ok');
    }
    return response.json();
  })
  .then(data => {
    console.log('Cleaners data:', data);
    // Process the data (e.g., update state)
  })
  .catch(error => {
    console.error('There was a problem with the fetch operation:', error);
  });
```