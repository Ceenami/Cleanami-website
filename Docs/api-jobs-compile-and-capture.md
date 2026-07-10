# API Endpoint Documentation: Job Completion & Payment Capture 💰

This document details the functionality of the Next.js API route responsible for finalizing a cleaning job, **capturing the customer payment**, applying a **reserve transaction**, and **creating cleaner payout records**.

This endpoint is intended to be called by the **Cleaner Mobile Application** upon confirmed job completion.

-----

## 🚀 Overview

The **Job Completion & Payment Capture** endpoint orchestrates the final financial and logistical steps of a cleaning job. It performs essential checks to ensure the work is complete, securely captures the pre-authorized customer funds via Stripe, accounts for a 2% reserve, updates the job status, and calculates and creates the individual payout records for all assigned cleaners.

-----

## 🔒 Endpoint Security and Requirements

| Detail | Value |
| :--- | :--- |
| **HTTP Method** | `POST` |
| **Path** | `/api/jobs/complete-and-capture` (Assumed) |
| **Authentication** | **API Key** in the `X-API-Key` header. |
| **Required Secret** | The key must match `process.env.CLEANER_APP_API_KEY`. |
| **Request Body** | JSON object with required field: `jobId` (string). |
| **Unauthorized Response** | `401 Unauthorized` if API key is invalid or missing. |
| **Bad Request Response** | `400 Bad Request` if `jobId` is missing or evidence is incomplete. |

-----

## ⚙️ Core Logic

The endpoint follows a strict, multi-step process:

### 1\. Pre-Capture Validation

1.  **Job ID Check**: Confirms the `jobId` is present in the request body.
2.  **Job Existence**: Fetches the job record from the database.
3.  **Payment Intent Check**: Verifies that a **`paymentIntentId`** exists (meaning the payment was successfully pre-authorized).
4.  **Double-Capture Check**: Returns a success message (`200 OK`) if the job's `paymentStatus` is already **`'captured'`**.
5.  **Evidence Validation**: Fetches the `evidencePackets` record for the job and enforces the following completion criteria:
      * `evidence.status` is **`'complete'`**.
      * `evidence.gpsCheckInTimestamp` is present.
      * `evidence.gpsCheckOutTimestamp` is present.
      * `evidence.isChecklistComplete` is `true`.
      * `evidence.photoUrls` array is present and has at least one URL.

### 2\. Stripe Payment Capture

1.  The system calls `stripe.paymentIntents.capture(job.paymentIntentId)`.
2.  **Success**: The pre-authorized customer funds are transferred to the platform's Stripe account.
3.  **Failure**: If the capture fails (e.g., card expired, insufficient funds), the job's `paymentStatus` is set to **`'capture_failed'`** in the database with the Stripe error message in the `notes`. An error response is returned.

### 3\. Reserve Transaction & Status Update

1.  **Reserve Calculation**: A **2% reserve** is calculated from the total `capturedAmount`.
      * $$ReserveAmount = \text{CapturedAmount} \times 0.02$$
2.  **Reserve Record**: A new record is inserted into the **`reserveTransactions`** table, detailing the captured, reserve, and net amounts.
3.  **Job Status Update**: The job's `paymentStatus` is updated to **`'captured'`**.

### 4\. Cleaner Payout Creation

1.  **Cleaner Assignment**: All assigned cleaners for the job are retrieved from the `jobsToCleaners` table.
2.  **Payout Calculation**: For each cleaner, the payout is calculated based on:
      * **Base Pay**: $\text{expectedHours} \times \$17/\text{hr}$ (Assumed rate).
      * **Urgent Bonus**: $+\$10$ if $job.isUrgentBonus$ is `true`.
      * **Laundry Bonus**: $+\$5 \times \text{laundryLoads}$ if the cleaner's role is **`'laundry_lead'`** and laundry was performed.
3.  **Payout Record Creation**: A new record is inserted into the **`payouts`** table for each assigned cleaner with:
      * The calculated total `amount` (formatted to two decimal places).
      * Breakdown of bonuses.
      * Initial **`status: 'pending'`**.

-----

## 💬 Response Structure (Success)

On successful completion of all steps (capture and payout creation):

```json
{
  "success": true,
  "message": "Payment captured and payouts created",
  "jobId": "uuid-here",
  "capturedAmount": 10500, // In Cents
  "reserveAmount": 210, // In Cents (2% of capturedAmount)
  "netAmount": 10290, // In Cents
  "paymentIntentId": "pi_xyz123",
  "payoutsCreated": 1 // Number of assigned cleaners
}
```