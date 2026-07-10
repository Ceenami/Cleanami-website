# Cron Job Documentation: Payment Pre-authorization 💳

This document details the functionality of the Next.js API route designed to run as a **cron job** for **payment pre-authorization** of cleaning jobs scheduled for the following day.

-----

## 🚀 Overview

This route is responsible for identifying scheduled cleaning jobs for **tomorrow** that have not yet had a payment intent created. For each eligible job, it calculates the service price, attempts to retrieve the customer's saved payment method on Stripe, and creates a **Stripe Payment Intent** with `capture_method: "manual"`. This action *authorizes* the funds on the customer's card without immediately capturing them, marking the job as **'authorized'** in the database.

It is intended to be called by an external cron service (e.g., Vercel Cron, a dedicated scheduler) daily.

-----

## 🛠️ Dependencies

| Module/Library | Purpose |
| :--- | :--- |
| `next/server` | Next.js request/response handling. |
| `@/db`, `drizzle-orm` | Database connection and query building (using Drizzle ORM). |
| `@/db/schemas` | Database table schemas (`jobs`, `properties`, `subscriptions`, `customers`). |
| `stripe` | Official Stripe Node.js library for payment processing. |
| `@/lib/services/pricing.service` | Custom service to calculate the price of a cleaning job. |

-----

## 🔒 Endpoint Security

The POST endpoint is secured to ensure only the designated cron service can trigger it.

| Detail | Value |
| :--- | :--- |
| **HTTP Method** | `POST` |
| **Authentication** | Bearer Token in the `Authorization` header. |
| **Required Secret** | The token must match the value of `process.env.CRON_SECRET`. |
| **Unauthorized Response** | `401 Unauthorized` if the token is invalid or missing. |

-----

## ⚙️ Core Logic (The `POST` Handler)

### 1\. Identify Target Jobs

The cron job calculates the time boundaries for **tomorrow** (from 12:00:00 AM to 11:59:59 PM).

It queries the database to find jobs that meet all the following criteria:

  * The job's **`checkOutTime`** is within **tomorrow's** date range (inclusive of tomorrow's start, exclusive of the day after tomorrow's start).
      * $jobs.checkOutTime \ge \text{Tomorrow Start}$
      * $jobs.checkOutTime < \text{Day After Tomorrow Start}$
  * The job's **`paymentIntentId`** is **`NULL`** (i.e., payment pre-authorization has not yet occurred).
  * The query joins `jobs`, `subscriptions`, `properties`, and `customers` to retrieve all necessary data in one go: `jobId`, property details (`propertyData`), and the customer's **`stripeCustomerId`**.

### 2\. Process Jobs for Pre-authorization

If jobs are found, the system iterates over them using `Promise.all` for concurrent processing:

1.  **Price Calculation**: Calls `pricingService.calculatePrice(propertyData)` to determine the service cost.
2.  **Amount Conversion**: The price is converted to **cents** for Stripe API.
3.  **Retrieve Payment Method**: Lists the customer's saved card payment methods on Stripe using the `stripeCustomerId`.
      * *Failure*: Throws an error if no card is found.
4.  **Create Payment Intent**: Creates a new Stripe Payment Intent with:
      * **`amount`**: The calculated cost in cents.
      * **`currency`**: `"usd"`.
      * **`customer`**: The customer's Stripe ID.
      * **`payment_method`**: The ID of the primary saved card.
      * **`capture_method`**: **`"manual"`** (This authorizes the charge without immediate capture).
      * **`confirm`**: **`true`** (Attempts to immediately authorize the charge).
5.  **Database Update (Success)**: If the payment intent creation succeeds, the local `jobs` record is updated:
      * `paymentIntentId` is set to the new Stripe ID.
      * `paymentStatus` is set to **`'authorized'`**.

### 3\. Error Handling and Logging

  * **Individual Job Errors**: If any step for a specific job fails (e.g., missing Stripe Customer ID, no saved payment method, Stripe authorization failure), a `try...catch` block handles it:
      * The error is logged to the console.
      * The local `jobs` record is updated with:
          * `paymentStatus` set to **`'failed'`**.
          * `notes` field is populated with the error message.
      * The overall cron process continues.
  * **System Errors**: Any failure outside the individual job loop (e.g., database connection issue, invalid cron secret) results in an HTTP `500 Internal Server Error` response.

-----

## 💬 Response Structure

The endpoint returns a JSON response indicating the outcome of the process.

### Success (Jobs Processed)

```json
{
  "message": "Pre-authorization process completed.",
  "processedCount": 5, // Number of jobs attempted
  "results": [
    { "jobId": 101, "status": "success" },
    { "jobId": 102, "status": "failed", "error": "No saved payment method found..." },
    // ... other results
  ]
}
```

### Success (No Jobs Found)

```json
{
  "message": "No jobs to process for tomorrow."
}
```

### Failure (Unauthorized Access)

  * **Status**: `401 Unauthorized`

<!-- end list -->

```json
{
  "error": "Unauthorized"
}
```

### Failure (Internal Error)

  * **Status**: `500 Internal Server Error`

<!-- end list -->

```json
{
  "error": "Internal Server Error",
  "details": "..." // Error message from the exception
}
```