# Cron Job Documentation: Cleaner Payout Processing 💰

This document details the functionality of the Next.js API route designed to run as a **cron job** for processing **pending cleaner payouts** via **Stripe Connect Transfers**.

-----

## 🚀 Overview

This route is responsible for iterating through all database records with a payout **`status` of 'pending'** and initiating a corresponding **Stripe Transfer** to the Cleaner's designated **Stripe Connect Express Account**. The goal is to ensure prompt, same-day payouts to cleaners after job completion.

It is designed to be called frequently (e.g., every 15-30 minutes) by an external cron service.

-----

## 🛠️ Dependencies

| Module/Library | Purpose |
| :--- | :--- |
| `next/server` | Next.js request/response handling. |
| `@/db`, `drizzle-orm` | Database connection and query building (using Drizzle ORM). |
| `@/db/schemas` | Database table schemas (`payouts`, `cleaners`). |
| `stripe` | Official Stripe Node.js library for creating transfers. |

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

### 1\. Identify Target Payouts

The route queries the database for all records in the `payouts` table where the `status` is **`'pending'`**.

It eagerly loads related data needed for the transfer:

  * The associated **`cleaner`** (specifically their `stripeAccountId`).
  * The associated **`job`** and **`property`** (for metadata/description purposes).

### 2\. Payout Validation & Processing Loop

The script iterates over each pending payout and performs necessary checks before attempting a Stripe Transfer:

| Condition | Action | DB Update | Status |
| :--- | :--- | :--- | :--- |
| **Cleaner missing `stripeAccountId`** | Logs an error. | `status: 'held'` | **Held ⚠️** |
| **Invalid/Zero Amount** (e.g., $\le \$0.00$) | Logs an error. | `status: 'held'` | **Held ⚠️** |
| **Amount too low** ($<\$1.00$) | Stripe minimum transfer limit. | `status: 'held'` | **Held ⚠️** |
| **Valid & Transfer Ready** | Proceeds to create Stripe Transfer. | `status: 'released'` | **Processed ✅** |

### 3\. Stripe Transfer Creation

For valid payouts, a transfer is created using the Stripe API:

  * **`amount`**: The payout amount is converted to **cents** (`Math.round(totalAmount * 100)`).
  * **`currency`**: `"usd"`.
  * **`destination`**: The Cleaner's **`stripeAccountId`** (Stripe Connect Express account ID).
  * **`description`**: Includes the truncated Job ID for easy reference.
  * **`metadata`**: Detailed information is attached for reconciliation, including `payoutId`, `jobId`, `cleanerName`, and breakdown of amounts (`totalAmount`, `urgentBonus`, `laundryBonus`).

Upon a successful transfer, the `payouts` record is updated with the Stripe Transfer ID (`stripePayoutId`) and the new **`status: 'released'`**.

### 4\. Error and Retry Handling

A robust `try...catch` block handles errors during the transfer attempt:

  * **Permanent Errors**: If the error is a definitive failure (e.g., invalid account details, unauthorized), the payout status is set to **`'held'`**. This requires manual review and resolution by an admin.
  * **Retriable Errors**: If the error is likely temporary (e.g., `StripeConnectionError`, `StripeAPIError`, `rate_limit`), the payout status **remains as `'pending'`**. The cron job will automatically retry the transfer during its next run.
  * All failures are logged to the console and recorded in the `results.errors` array.

-----

## 💬 Response Structure

The endpoint returns a detailed JSON response summarizing the execution.

### Success Summary

```json
{
  "success": true,
  "message": "Payout processing complete",
  "totalPendingFound": 10,
  "processed": 8,
  "failed": 0,
  "held": 2,
  "totalPaidOutUSD": "1256.50",
  "errors": [
    // Array of failed/held payouts, only included if errors.length > 0
  ]
}
```

### Success (No Pending Payouts)

```json
{
  "message": "No pending payouts to process",
  "processed": 0
}
```

### Failure (Internal Error)

  * **Status**: `500 Internal Server Error`

<!-- end list -->

```json
{
  "error": "Internal server error",
  "details": "..." // Error message from the exception
}
```