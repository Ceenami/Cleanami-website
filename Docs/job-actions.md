## 📄 Documentation: `capturePaymentForJob`

This server-side function is responsible for finalizing a payment for a completed job by calling the **Stripe Capture API**. It performs necessary checks on user authorization and job status, updates the payment and job statuses in the database, and handles transactional failure logging.

-----

### **Overview**

  * **File Context**: This is a **Server Action** (`"use server"`) designed to be called by an authorized user (likely an administrator or a specific backend process) once a job is confirmed as complete.
  * **Purpose**: To transition a pre-authorized payment hold (a state in which funds are reserved) into a confirmed, captured charge, and update the associated job's status.
  * **Dependencies**:
      * **Stripe Node.js Library**: To interact with the Stripe Payment Intents API.
      * **Supabase Client**: For user authorization.
      * **Drizzle ORM (`db`, `jobs`)**: For database lookups and status updates.

-----

### **`capturePaymentForJob(jobId)` Function**

An asynchronous function that captures a pre-authorized payment intent associated with a specific job.

#### **Signature**

```typescript
export async function capturePaymentForJob(jobId: string): Promise<{
  success: boolean;
  message: string;
}>
```

#### **Parameters**

| Name | Type | Description |
| :--- | :--- | :--- |
| `jobId` | `string` | The unique identifier of the job whose payment needs to be captured. |

#### **Returns**

A Promise that resolves to an object indicating the result of the operation.

| Property | Type | Description |
| :--- | :--- | :--- |
| **`success`** | `boolean` | `true` if the payment was successfully captured by Stripe and the database was updated. |
| **`message`** | `string` | A status message (success or detailed error) explaining the outcome. |

-----

### **Step-by-Step Process & Validation**

The function enforces a strict set of checks before attempting to capture the payment:

1.  **Authorization Check**:

      * It checks if a **logged-in user** is making the request using `supabase.auth.getUser()`. If no user is found, the process stops with an `Unauthorized` error.

2.  **Job Lookup**:

      * It retrieves the job record from the **`jobs`** table using the provided `jobId`.

3.  **Job and Payment Intent Validation**:

      * It verifies that the job exists.
      * It verifies that the job has an associated **`paymentIntentId`**.
      * **Crucially**, it verifies that the job's current `paymentStatus` is **`"authorized"`**. Payment can only be captured from an authorized state.

4.  **Stripe Capture API Call**:

      * If all checks pass, it calls **`stripe.paymentIntents.capture(job.paymentIntentId)`**. This finalizes the charge and moves the reserved funds to your account.

5.  **Database Update (Success)**:

      * Upon successful capture by Stripe, the local **`jobs`** record is updated transactionally:
          * `paymentStatus` is set to **`"captured"`**.
          * `status` is set to **`"completed"`**.

6.  **Database Update (Failure and Rollback)**:

      * If the Stripe API call fails for any reason (e.g., card expired, network error), the error is caught.
      * The local **`jobs`** record is updated with:
          * `paymentStatus` set to **`"capture_failed"`**.
          * A detailed note is added to the `notes` column for auditing purposes.

This pattern ensures that your local database accurately reflects the status of the job and payment, even in failure scenarios.