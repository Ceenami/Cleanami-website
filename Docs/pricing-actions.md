## 📄 Documentation: `handleFileUpload` (Pricing Rule Uploader)

This server-side function manages the entire workflow for updating various pricing rules from a user-uploaded CSV file. It handles user authentication, secure file storage (via Supabase Storage), CSV parsing, transactional database updates (using Drizzle ORM), and client-side cache invalidation (using Next.js `revalidateTag`).

-----

### **Overview**

  * **File Context**: This is a **Server Action** or server-side function, indicated by `"use server"`. It is designed to be called directly from a client-side form submission or another server process.
  * **Dependencies**:
      * **Supabase**: For user authentication and file storage.
      * **Drizzle ORM (`drizzle-orm`, `db`, and schema imports)**: For transactional database operations.
      * **Papa Parse (`papaparse`)**: For efficiently parsing the CSV file content.
      * **Next.js (`next/cache`)**: For cache invalidation.
  * **Purpose**: To securely and transactionally update a specific set of pricing rules in the database using data from an uploaded CSV file.

-----

### **`PricingFileType` Type Definition**

This union type defines the specific pricing tables that can be updated by the function. Each value dictates which database table will be cleared and repopulated.

```typescript
export type PricingFileType =
  | "base_prices"       // Updates the base pricing rules table
  | "sqft_surcharges"   // Updates the square footage surcharge rules table
  | "laundry_pricing"   // Updates the laundry service pricing rules table
  | "hot_tub_pricing"; // Updates the hot tub service pricing rules table
```

-----

### **`handleFileUpload(formData, fileType)` Function**

An asynchronous function to process a file upload for a specific type of pricing data.

#### **Signature**

```typescript
export async function handleFileUpload(
  formData: FormData,
  fileType: PricingFileType
): Promise<{ success: boolean; message: string }>
```

#### **Parameters**

| Name | Type | Description |
| :--- | :--- | :--- |
| `formData` | `FormData` | The form data object from the client. It is expected to contain a **File** object under the key **`pricingCsv`**. |
| `fileType` | `PricingFileType` | A string specifying which set of pricing rules is being updated (e.g., `"base_prices"`). |

#### **Returns**

A Promise that resolves to an object indicating the result of the operation.

| Property | Type | Description |
| :--- | :--- | :--- |
| `success` | `boolean` | `true` if the file was processed, uploaded, and the database was updated successfully. |
| `message` | `string` | A success or error message explaining the outcome. |

-----

### **Step-by-Step Process & Logic**

The function executes a robust, multi-stage workflow:

1.  **Authentication & Authorization**:

      * It initializes the Supabase client (`createClient`).
      * It checks if a **logged-in user** exists. If not, the process halts with an `Unauthorized` error.

2.  **Input Validation**:

      * It extracts the uploaded file from the `formData` using the key `"pricingCsv"`.
      * It verifies that a file was actually provided.

3.  **Audit Log Initialization**:

      * A record is immediately inserted into the **`pricingUploads`** table with `status: "processing"`. This ensures there is a log of the upload attempt, even if the process fails later.

4.  **File Storage (Supabase)**:

      * The file is uploaded to the **`pricing-files`** bucket in Supabase Storage with a unique, timestamped path (`pricing_csvs/...`).
      * The **`fileUrl`** in the `pricingUploads` audit record is updated with the public URL of the uploaded file.

5.  **CSV Parsing**:

      * The file contents are read into memory as text.
      * **Papa Parse** is used to convert the CSV data into an array of JavaScript objects (`parsedCsv.data`), using the first row as **headers**.
      * It checks for any parsing errors.

6.  **Transactional Database Update (Atomic Change)**:

      * All database modification steps are wrapped in a **Drizzle transaction (`db.transaction`)**. This critical step ensures that **if any part of the data insertion fails, the entire operation is rolled back**, preventing partial or corrupted data updates.
      * Inside the transaction:
          * The existing data for the corresponding pricing table (`fileType`) is **deleted** (a full replacement strategy).
          * The parsed CSV data is **mapped and transformed** into the correct Drizzle schema format. **Note**: all monetary values are converted to **cents** (`* 100`) to prevent floating-point errors.
          * The new, transformed data is **inserted** into the table.

7.  **Final Status & Cache Invalidation**:

      * If the transaction succeeds, the `pricingUploads` audit record is updated to `status: "success"`.
      * **`revalidateTag("pricing_rules")`** is called. This invalidates any cached data (like data fetched in other Server Components) that depends on the pricing rules, ensuring the application immediately uses the new data.

8.  **Error Handling**:

      * A `try...catch` block surrounds the entire main process.
      * Upon any failure (upload error, parsing error, or database error), the `pricingUploads` audit record is updated to `status: "failed"` with a `notes` field containing the error message.
      * The function returns a `success: false` result with the error message.

### **Expected CSV Headers for Each `fileType`**

To map correctly, the uploaded CSV **must** use the following headers (case-sensitive) for the respective file types:

| `fileType` | Required CSV Headers | Transformation Notes |
| :--- | :--- | :--- |
| **`base_prices`** | `Bedrooms`, `1_Bath`, `2_Bath`, `3_Bath`, `4_Bath`, `5_Bath` | All prices are converted from dollars to cents and `Bedrooms` is parsed as an integer. |
| **`sqft_surcharges`** | `Range_Start`, `Range_End`, `Surcharge_Amount` | `Range_Start`/`End` are parsed as integers. `Surcharge_Amount` is converted to cents, unless it's `"custom quote"`, which sets the surcharge to `0` and `isCustomQuote` to `true`. |
| **`laundry_pricing`** | `Service_Type`, `Customer_Revenue_Base`, `Customer_Revenue_Per_Load`, `Cleaner_Bonus_Per_Load` | All revenue/bonus amounts are converted from dollars to cents. |
| **`hot_tub_pricing`** | `Service_Type`, `Customer_Revenue`, `Time_Add_Hours` | `Customer_Revenue` is converted to cents. `Time_Add_Hours` is kept as a string/text. |