# Cron Job Documentation: Automated iCal Calendar Sync 🗓️

This document details the functionality of the Next.js API route designed to run as a **cron job** for automatically synchronizing external calendars (via iCal URLs) for all **active customer subscriptions**.

-----

## 🚀 Overview

This route orchestrates the daily (or frequent) synchronization of **customer booking calendars** with the internal system. By fetching and processing external iCal files, it ensures the platform's job schedule accurately reflects the customer's availability and existing bookings (e.g., Airbnb, VRBO, or personal calendars), automatically creating or updating relevant internal **job records**.

It is intended to be called by an external cron service (e.g., Vercel Cron, AWS EventBridge) on a regular schedule.

-----

## 🛠️ Dependencies

| Module/Library | Purpose |
| :--- | :--- |
| `@/db`, `drizzle-orm` | Database connection and query building. |
| `@/db/schemas/subscriptions.schema` | Database schema for the `subscriptions` table. |
| `@/lib/services/iCal/ical.service` | Custom service encapsulating the logic for fetching, parsing, and processing iCal data to update the job schedule. |

-----

## 🔒 Endpoint Security

The GET endpoint is secured to ensure only the designated cron service can trigger it.

| Detail | Value |
| :--- | :--- |
| **HTTP Method** | `GET` |
| **Authentication** | Bearer Token in the `Authorization` header. |
| **Required Secret** | The token must match the value of `process.env.CRON_SECRET`. |
| **Unauthorized Response** | `401 Unauthorized` if the token is invalid or missing. |

-----

## ⚙️ Core Logic (The `GET` Handler)

### 1\. Identify Target Subscriptions

The route queries the database to find all **active subscriptions** (`subscriptions.status = 'active'`). It eagerly loads the associated **`property`** data, as this is where the `iCalUrl` is stored.

### 2\. Iterative Sync Process

The system iterates through the list of active subscriptions, managing success and failure for each one.

| Step | Action | Outcome | Database Update |
| :--- | :--- | :--- | :--- |
| **Check URL** | Checks if `subscription.property.iCalUrl` is present. | **Skipped** if missing. | N/A |
| **Call Service** | Calls `icalService.syncCalendar({ subscriptionId })`. | **Successful** if the service returns `success: true`. | `iCalSyncFailed: false`, `lastSyncAttempt: new Date()` |
| **Service Failure** | Service returns `success: false` or throws an exception. | **Failed** and error details are logged. | `iCalSyncFailed: true`, `lastSyncAttempt: new Date()` |

The `ICalService.syncCalendar` is responsible for:

1.  Downloading the iCal file from the URL.
2.  Parsing the event data (check-in/check-out dates).
3.  Comparing external events to existing internal jobs.
4.  Creating new job records (or updating existing ones) based on the iCal schedule.

### 3\. Reporting

The route maintains a `results` object to track the outcome of the entire batch process:

  * `total`: Total active subscriptions found.
  * `successful`: Number of subscriptions synced successfully.
  * `failed`: Number of subscriptions that encountered a sync error.
  * `skipped`: Number of subscriptions lacking an iCal URL.
  * `errors`: An array containing details (`subscriptionId`, `error`) for all failures.

-----

## 💬 Response Structure

The endpoint returns a JSON response summarizing the sync process.

### Success (Sync Completed)

  * **Status**: `200 OK`

<!-- end list -->

```json
{
  "success": true,
  "message": "Synced 15 of 20 calendars (5 skipped)",
  "results": {
    "total": 20,
    "successful": 15,
    "failed": 0,
    "skipped": 5,
    "errors": []
  },
  "timestamp": "2023-10-07T22:01:57.000Z"
}
```

### Success with Failures

  * **Status**: `200 OK`

<!-- end list -->

```json
{
  "success": true,
  "message": "Synced 14 of 20 calendars (1 failed, 5 skipped)",
  "results": {
    "total": 20,
    "successful": 14,
    "failed": 1,
    "skipped": 5,
    "errors": [
      {
        "subscriptionId": "sub_xyz",
        "error": "iCal file not found at URL: 404 error"
      }
    ]
  },
  "timestamp": "..."
}
```

### Failure (Fatal Error)

  * **Status**: `500 Internal Server Error` (Error occurred before or outside the main loop, e.g., database connection failure).

<!-- end list -->

```json
{
  "success": false,
  "error": "Fatal error during sync",
  "message": "..." // Details of the exception
}
```