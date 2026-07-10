Setting up a cron job using **cron-job.org** is straightforward. This service acts as an external scheduler that periodically makes an HTTP request to your specified API endpoint, triggering your serverless cron logic.

Here are the step-by-step instructions:

---

## 1. Prerequisites 📋

Before you start, you'll need the following:

1.  **Your Endpoint URL**: The full, accessible URL of the API endpoint you want to run (e.g., `https://api.yourdomain.com/api/cron/payment-capture`).
2.  **Your Cron Secret**: The security token defined in your environment variables (e.g., `process.env.CRON_SECRET` or `process.env.CLEANER_APP_API_KEY`). This is essential for authorization.

---

## 2. Setting Up the Cron Job on cron-job.org 🌐

### Step 2.1: Create an Account & Log In

1.  Navigate to **cron-job.org**.
2.  **Sign up** for a free account or **log in**.

### Step 2.2: Add a New Cron Job

1.  Once logged in, click the **"Create cronjob"** button.

### Step 2.3: Configure Basic Settings

| Field | Value/Description |
| :--- | :--- |
| **Title** | A descriptive name (e.g., **`Daily iCal Sync`**, **`Hourly Payout Processor`**). |
| **Address** | Paste your full **API Endpoint URL** here. |
| **HTTP Method** | Select the method your endpoint requires (e.g., **`GET`** for the iCal sync, **`POST`** for payment pre-auth). |

---

## 3. Scheduling and Security Configuration 🔒

### Step 3.1: Set the Schedule

1.  In the **"Schedule"** section, choose how often the job should run.
    * **Common Options:** Use the dropdowns or the visual selector.
        * **Daily Pre-Auth:** Select **`Daily`** at a specific time (e.g., **`1:00 AM`**).
        * **Frequent Payouts/iCal Sync:** Select **`Hourly`** and specify minutes (e.g., every 15 minutes: `0, 15, 30, 45`).
    * **Expert Mode:** If you need a custom schedule, switch to "Expert Mode" and enter a standard **CRON expression** (e.g., `0 */6 * * *` to run every 6 hours).

### Step 3.2: Configure Authorization Headers

This step is **crucial** for security, as your endpoints require a secret token.

1.  Scroll down to the **"Settings"** section.
2.  Click on the **"Headers"** sub-section to expand it.
3.  Add the required authorization header(s) based on your specific cron job:

| Job Type | Header Key | Header Value | Notes |
| :--- | :--- | :--- | :--- |
| **Payment Pre-Auth** | `Authorization` | `Bearer <YOUR_CRON_SECRET>` | Use for the `POST /api/cron/pre-authorize` job. |
| **iCal Sync** | `Authorization` | `Bearer <YOUR_CRON_SECRET>` | Use for the `GET /api/cron/ical-sync` job. |
| **Job Capture (Cleaner App)** | `X-API-Key` | `<YOUR_CLEANER_APP_API_KEY>` | **Note:** This job is usually triggered by the app, not cron-job.org. |

---

## 4. Final Steps and Testing ✅

### Step 4.1: Save the Cron Job

1.  Click the **"Create cronjob"** button at the bottom. The job is now live.

### Step 4.2: Manual Test

1.  Find your newly created job in the list.
2.  Click the **"Run now"** button (play icon) to manually trigger the job.
3.  Check the **"History"** tab to verify the outcome:
    * A **green checkmark** indicates a successful run (usually resulting in an HTTP status of `200`).
    * A **red 'x'** or other error indicates a failure (e.g., `401 Unauthorized` if your secret is wrong, or `500 Internal Server Error`).

Ensure the **Response** and **Status Code** match the expected successful output described in your documentation.