## 📄 Documentation: `completeOnboarding`

This server-side function finalizes the user's booking process after a successful payment. It is a critical **Server Action** that ensures all customer, property, and subscription details are recorded in the database and external services are initialized.

-----

### **Overview**

  * **File Context**: This is a **Server Action** (`"use server"`) designed to be called only **after a Stripe Payment Intent has been successfully confirmed** on the client.
  * **Purpose**: To transition a paid booking from temporary client data into persistent records within the database, including geocoding the property, managing customer data, storing file uploads, and initiating calendar synchronization.
  * **Criticality**: This function must be robust and transactional, as it runs after a user has paid.

-----

### **`completeOnboarding(formData, paymentIntentId)` Function**

An asynchronous function that processes and persists all data for a new customer subscription.

#### **Signature**

```typescript
export async function completeOnboarding(
  formData: SignupFormData,
  paymentIntentId: string
): Promise<{ success: boolean; data?: any; error?: string }>
```

#### **Parameters**

| Name | Type | Description |
| :--- | :--- | :--- |
| `formData` | `SignupFormData` | The complete, validated data from the user's signup form. |
| `paymentIntentId` | `string` | The ID of the Stripe Payment Intent that was successfully completed for the first payment. |

#### **Returns**

A Promise that resolves to an object indicating the result of the operation.

| Property | Type | Description |
| :--- | :--- | :--- |
| **`success`** | `boolean` | `true` if all database and external steps completed successfully. |
| **`data`** | `object` | An object containing the newly created `customer`, `property`, and `subscription` records. |
| **`error`** | `string` | A user-friendly error message if any part of the onboarding process fails. |

-----

### **Step-by-Step Process & Workflow**

The function follows a strict sequence of validation, external service interaction, and a database transaction:

1.  **Input Validation**:

      * The `formData` is parsed and validated against the **`signupFormSchema`** using Zod to ensure data integrity and completeness.

2.  **Stripe Payment Intent Verification**:

      * It retrieves the **`paymentIntent`** from the Stripe API using the provided `paymentIntentId`.
      * It extracts the **`stripeCustomerId`** from the Payment Intent to link all local records to the correct Stripe customer.

3.  **Geocoding**:

      * The property `address` is sent to the **Google Maps Geocoding API** to determine the latitude and longitude coordinates. This information is crucial for location-based logistics.
      * This process runs *outside* the main database transaction.

4.  **Transactional Database Save (Atomic)**:

      * All key database operations are wrapped in a **Drizzle transaction (`db.transaction`)** to ensure atomicity. If any step (insert, update, or file-related action) fails, the entire transaction is rolled back, preventing orphaned or incomplete records.

    A. **Customer Upsert**:

      * An **`onConflictDoUpdate`** (upsert) is performed on the `customers` table using the **email** as the unique key.
          * If the email exists, the record (including `name`, `phone`, and `stripeCustomerId`) is updated.
          * If the email is new, a new customer record is created.

    B. **Property Insert**:

      * A new record is inserted into the **`properties`** table, linked to the new or updated customer.
      * The geocoded latitude, longitude, and timestamp are included if the geocoding step was successful.

    C. **Checklist File Upload (Supabase)**:

      * If the user uploaded a custom checklist file(s), each file is securely uploaded to **Supabase Storage** under a path specific to the new `property.id`.
      * A corresponding record is created in the **`checklistFiles`** table to track the file location and details.

    D. **Subscription Insert**:

      * A new record is inserted into the **`subscriptions`** table, linking the `customer`, `property`, and the `paymentIntentId`.
      * It calculates the `endDate` based on the `subscriptionMonths` and sets the initial status to `"active"`.

5.  **Initial Calendar Synchronization (Post-Transaction)**:

      * After the database transaction successfully commits, if an **`iCalUrl`** was provided, the **`ICalService.syncCalendar`** is called asynchronously. This triggers the initial import of cleaning dates from the user's external calendar, if applicable.
      * This step is *not* part of the transaction, but its failure is logged as **CRITICAL** for operational awareness.

6.  **Error Handling**:

      * A comprehensive `try...catch` block handles errors at any stage, logging detailed information (including the `paymentIntentId` and `formData`) to the console for debugging while returning a generic failure message to the user.

-----

### **`geocodeAddress` Utility**

This internal, private function is responsible for calling the Google Maps Geocoding API to resolve a human-readable address into GPS coordinates.

```typescript
async function geocodeAddress(address: string): Promise<{ latitude: string; longitude: string } | null>
```