## Drizzle ORM Schema Documentation

---

### `customers.schema.ts`

This schema defines the **`customers`** table, which stores information about the users/clients of the service.

| Component | Detail | Notes |
| :--- | :--- | :--- |
| **Table Name** | `customers` | Main table for all clients. |
| **Table Columns** | | |
| `id` | `uuid().primaryKey().defaultRandom()` | Unique primary key for the customer. |
| `name` | `text().notNull()` | Full name of the customer. |
| `email` | `text().notNull().unique()` | Customer's email address, must be unique. Indexed. |
| `phone` | `text().nullable()` | Customer's phone number. |
| `stripeCustomerId` | `text().unique().nullable()` | ID for Stripe customer, unique. Indexed. |
| `createdAt` | `timestamp().defaultNow().notNull()` | Timestamp of creation. |
| `updatedAt` | `timestamp().defaultNow().notNull()` | Timestamp of last update. |
| **Indexes** | `customers_email_idx` | Index on `email` for quick lookups. |
| | `customers_stripe_idx` | Index on `stripeCustomerId`. |
| **Schema/Types** | `insertCustomerSchema`, `selectCustomerSchema` | Zod schemas for validation. `NewCustomer`, `Customer` types. |

---

### `properties.schema.ts`

This schema defines the **`properties`** table, which holds details for each property/home associated with a customer.

| Component | Detail | Notes |
| :--- | :--- | :--- |
| **Table Name** | `properties` | |
| **Table Columns** | | |
| `id` | `uuid().primaryKey().defaultRandom()` | Unique primary key. |
| `customerId` | `uuid().notNull()` | **Foreign Key** to `customers.id`. On Delete: `cascade`. Indexed. |
| `address` | `text().notNull()` | The physical address of the property. |
| `sqFt` | `integer().nullable()` | Square footage of the property. |
| `bedCount` | `integer().notNull()` | Number of bedrooms. |
| `bathCount` | `numeric(3, 1).notNull()` | Number of bathrooms (e.g., 2.5). |
| `hasHotTub` | `boolean().default(false).notNull()` | Does the property have a hot tub? |
| `laundryType` | `varchar().notNull()` | Enum: `in_unit`, `off_site`, `none`. |
| `laundryLoads` | `integer().nullable()` | Estimated number of laundry loads. |
| `hotTubServiceLevel` | `boolean().default(false).notNull()` | Is hot tub service included? |
| `hotTubDrain` | `boolean().default(false).notNull()` | Does the hot tub need a drain/refill service? |
| `hotTubDrainCadence` | `varchar().nullable()` | Enum: `4_weeks`, `6_weeks`, `2_months`, etc. |
| `useDefaultChecklist` | `boolean().default(false).notNull()` | Use the system's default checklist. |
| `latitude` | `numeric(10, 8).nullable()` | Geocoded latitude. Indexed for location. |
| `longitude` | `numeric(11, 8).nullable()` | Geocoded longitude. Indexed for location. |
| `geocodedAt` | `timestamp().nullable()` | When the location was last geocoded. |
| `iCalUrl` | `text().nullable()` | URL for calendar synchronization. |
| `createdAt` | `timestamp().defaultNow().notNull()` | Timestamp of creation. |
| `updatedAt` | `timestamp().defaultNow().notNull()` | Timestamp of last update. |
| **Indexes** | `properties_customer_idx` | Index on `customerId`. |
| | `properties_location_idx` | Compound index on `latitude` and `longitude`. |
| **Schema/Types** | `insertPropertySchema`, `selectPropertySchema` | Zod schemas. `NewProperty`, `Property` types. |

---

### `subscriptions.schema.ts`

This schema defines the **`subscriptions`** table, tracking a customer's recurring service plan for a property.

| Component | Detail | Notes |
| :--- | :--- | :--- |
| **Table Name** | `subscriptions` | |
| **Table Columns** | | |
| `id` | `uuid().primaryKey().defaultRandom()` | Unique primary key. |
| `customerId` | `uuid().notNull()` | **Foreign Key** to `customers.id`. On Delete: `cascade`. Indexed. |
| `propertyId` | `uuid().notNull()` | **Foreign Key** to `properties.id`. On Delete: `cascade`. Indexed. |
| `stripeSubscriptionId` | `text().unique().nullable()` | ID for Stripe subscription. |
| `durationMonths` | `integer().notNull()` | Length of the subscription term in months. |
| `status` | `varchar().default("pending").notNull()` | Enum: `active`, `expired`, `canceled`, `pending`. |
| `firstCleanPaymentId` | `text().unique().nullable()` | ID of the payment for the initial cleaning. |
| `isFirstCleanPrepaid` | `boolean().default(false).notNull()` | Was the first clean paid for upfront? |
| `iCalSyncFailed` | `boolean().default(false)` | Flag for iCal sync failures. |
| `lastSyncAttempt` | `timestamp().nullable()` | Last attempt at iCal synchronization. |
| `startDate` | `date().notNull()` | The date the subscription starts. |
| `endDate` | `date().notNull()` | The date the subscription ends. |
| `createdAt` | `timestamp().defaultNow().notNull()` | Timestamp of creation. |
| `updatedAt` | `timestamp().defaultNow().notNull()` | Timestamp of last update. |
| **Indexes** | `subscriptions_customer_idx` | Index on `customerId`. |
| | `subscriptions_property_idx` | Index on `propertyId`. |
| **Schema/Types** | `insertSubscriptionSchema`, `selectSubscriptionSchema` | Zod schemas. `NewSubscription`, `Subscription` types. |

---

### `checklistFiles.schema.ts`

This schema defines the **`checklist_files`** table for custom cleaning checklists uploaded by a property owner.

| Component | Detail | Notes |
| :--- | :--- | :--- |
| **Table Name** | `checklist_files` | |
| **Table Columns** | | |
| `id` | `uuid().primaryKey().defaultRandom()` | Unique primary key. |
| `propertyId` | `uuid().notNull()` | **Foreign Key** to `properties.id`. On Delete: `cascade`. |
| `fileName` | `text().notNull()` | Original file name of the uploaded checklist. |
| `storagePath` | `text().notNull().unique()` | Path to the file in storage (e.g., S3). Must be unique. |
| `fileSize` | `integer().nullable()` | Size of the file in bytes. |
| `createdAt` | `timestamp().defaultNow().notNull()` | Timestamp of creation. |
| **Schema/Types** | `insertChecklistFileSchema`, `selectChecklistFileSchema` | Zod schemas. `NewChecklistFile`, `ChecklistFile` types. |

---

### `cleaners.schema.ts`

This schema defines the **`cleaners`** table for personnel who perform the cleaning jobs.

| Component | Detail | Notes | |
| :--- | :--- | :--- | :--- |
| **Table Name** | `cleaners` | | |
| **Table Columns** | | | |
| `id` | `uuid().primaryKey().defaultRandom()` | Unique primary key. | |
| `fullName` | `text().notNull()` | Cleaner's full name. | |
| `email` | `text().notNull().unique()` | Cleaner's email, must be unique. | |
| `phone` | `text().nullable()` | Cleaner's phone number. | |
| `address` | `text().nullable()` | Cleaner's address. | |
| `profilePhotoUrl` | `text().nullable()` | URL for profile photo. | |
| `experienceYears` | `integer().nullable()` | Years of cleaning experience. | |
| `hasHotTubCert` | `boolean().default(false)` | Does the cleaner have a hot tub certification? | |
| `reliabilityScore` | `numeric(5, 2).nullable()` | Score for job assignment ranking. Indexed. | |
| `onCallStatus` | `pgEnum('on_call_status').default('unavailable')` | Enum: `available`, `unavailable`, `on_job`. | |
| `stripeAccountId` | `text().unique().nullable()` | ID for Stripe Connect account, unique. | |
| `latitude` | `numeric(10, 8).nullable()` | Geocoded latitude. Indexed for location. | |
| `longitude` | `numeric(11, 8).nullable()` | Geocoded longitude. Indexed for location. | |
| `geocodedAt` | `timestamp().nullable()` | When the location was last geocoded. | |
| `legalDocsSigned` | `jsonb().nullable()` | Stores URLs for signed legal documents (W9, waivers). | |
| `createdAt` | `timestamp().defaultNow().notNull()` | Timestamp of creation. | |
| `updatedAt` | `timestamp().defaultNow().notNull()` | Timestamp of last update. | |
| **Indexes** | `cleaners_reliability_idx` | Index on `reliabilityScore`. | |
| | `cleaners_location_idx` | Compound index on `latitude` and `longitude`. | |

---

### `jobs.schema.ts`

This schema defines the **`jobs`** table, representing a single scheduled cleaning instance. It also includes the join table for assigning cleaners to jobs.

#### Jobs Table (`jobs`)

| Component | Detail | Notes |
| :--- | :--- | :--- |
| **Table Name** | `jobs` | |
| **Table Columns** | | |
| `id` | `uuid().primaryKey().defaultRandom()` | Unique primary key. |
| `subscriptionId` | `uuid().nullable()` | **Foreign Key** to `subscriptions.id`. |
| `propertyId` | `uuid().nullable()` | **Foreign Key** to `properties.id`. |
| `status` | `pgEnum('job_status').default('unassigned')` | Enum: `unassigned`, `assigned`, `in-progress`, `completed`, `canceled`. Indexed. |
| `checkInTime` | `timestamp(withTimezone: true).nullable()` | Actual time cleaner arrived. |
| `checkOutTime` | `timestamp(withTimezone: true).nullable()` | Actual time cleaner departed. |
| `calendarEventUid` | `text().notNull()` | Unique ID from an external calendar system. Unique index. |
| `expectedHours` | `numeric(4, 2).nullable()` | Estimated time for the job. |
| `addonsSnapshot` | `jsonb().nullable()` | Stores addon details like laundry/hot tub service *at the time of job creation*. |
| `paymentIntentId` | `text().nullable()` | ID from payment processor (e.g., Stripe). |
| `paymentStatus` | `pgEnum('payment_status').nullable()` | Enum: `pending`, `authorized`, `captured`, `failed`, `capture_failed`. |
| `paymentFailed` | `boolean().default(false)` | Flag if the payment attempt failed. |
| `notes` | `text().nullable()` | Any specific notes for the job. |
| `createdAt` | `timestamp().defaultNow().notNull()` | Timestamp of creation. |
| `updatedAt` | `timestamp().defaultNow().notNull()` | Timestamp of last update. |
| **Indexes** | `calendar_event_uid_idx` | Unique index on `calendarEventUid`. |
| | `jobs_status_idx` | Index on `status`. |

#### Job-Cleaner Join Table (`jobs_to_cleaners`)

This is a many-to-many join table connecting `jobs` and `cleaners`.

| Component | Detail | Notes |
| :--- | :--- | :--- |
| **Table Name** | `jobs_to_cleaners` | |
| **Table Columns** | | |
| `jobId` | `uuid().notNull()` | **Foreign Key** to `jobs.id`. On Delete: `cascade`. |
| `cleanerId` | `uuid().notNull()` | **Foreign Key** to `cleaners.id`. On Delete: `cascade`. |
| `role` | `pgEnum('job_cleaner_role').notNull()` | Enum: `primary`, `backup`, `on-call`, `laundry_lead`. |
| **Primary Key** | `pk` | Composite Primary Key on `(jobId, cleanerId, role)`. |

---

### `payouts.schema.ts`

This schema defines the **`payouts`** table, tracking payments to cleaners for completed jobs.

| Component | Detail | Notes |
| :--- | :--- | :--- |
| **Table Name** | `payouts` | |
| **Table Columns** | | |
| `id` | `uuid().primaryKey().defaultRandom()` | Unique primary key. |
| `jobId` | `uuid().notNull()` | **Foreign Key** to `jobs.id`. On Delete: `cascade`. |
| `cleanerId` | `uuid().notNull()` | **Foreign Key** to `cleaners.id`. On Delete: `cascade`. |
| `amount` | `numeric(10, 2).notNull()` | The base amount of the payout. |
| `urgentBonusAmount` | `numeric(10, 2).nullable()` | Bonus for urgent jobs. |
| `laundryBonusAmount` | `numeric(10, 2).nullable()` | Bonus for handling laundry. |
| `stripePayoutId` | `text().unique().nullable()` | ID from payment processor for the actual payout. |
| `status` | `pgEnum('payout_status').default('pending')` | Enum: `pending`, `released`, `held`. |
| `createdAt` | `timestamp().defaultNow().notNull()` | Timestamp of creation. |
| `updatedAt` | `timestamp().defaultNow().notNull()` | Timestamp of last update. |

---

### `reserveTransactions.schema.ts`

This schema defines the **`reserve_transactions`** table, tracking the financial breakdown of job payments, including amounts held in reserve.

| Component | Detail | Notes |
| :--- | :--- | :--- |
| **Table Name** | `reserve_transactions` | |
| **Table Columns** | | |
| `id` | `uuid().primaryKey().defaultRandom()` | Unique primary key. |
| `jobId` | `uuid().notNull()` | **Foreign Key** to `jobs.id`. On Delete: `cascade`. |
| `paymentIntentId` | `text().notNull()` | ID of the payment intent processed for the job. |
| `totalAmountCents` | `integer().notNull()` | The full amount charged to the customer (in cents). |
| `reserveAmountCents` | `integer().notNull()` | The amount held in reserve (e.g., 2% of total). |
| `netAmountCents` | `integer().notNull()` | `totalAmountCents` minus fees and reserve amount. |
| `createdAt` | `timestamp().defaultNow().notNull()` | Timestamp of creation. |

---

### `pricing.schema.ts`

This schema contains several tables for defining the dynamic pricing structure of the service.

#### Pricing Uploads (`pricing_uploads`)

| Table Name | `pricing_uploads` | Stores metadata about bulk pricing sheet uploads. |
| :--- | :--- | :--- |
| `id` | `uuid().primaryKey().defaultRandom()` | |
| `fileName` | `varchar(255).notNull()` | |
| `fileUrl` | `text().notNull()` | |
| `status` | `varchar().default("processing").notNull()` | Enum: `processing`, `success`, `failed`. |
| `notes` | `text().nullable()` | |
| `uploadedBy` | `uuid().references(() => users.id)` | **Foreign Key** to an external `users` table. |
| `createdAt` | `timestamp().defaultNow().notNull()` | |

#### Base Pricing Rules (`base_pricing_rules`)

| Table Name | `base_pricing_rules` | Defines base price based on bedrooms and bathrooms. |
| :--- | :--- | :--- |
| `id` | `uuid().primaryKey().defaultRandom()` | |
| `bedrooms` | `integer().notNull().unique()` | The key differentiator for pricing. Must be unique. |
| `price1BathCents` | `integer().notNull()` | Base price (in cents) for a 1-bath home. |
| `price2BathCents` | `integer().notNull()` | Base price (in cents) for a 2-bath home. |
| `price...Cents` | `integer().notNull()` | Columns for 3, 4, and 5-bath homes. |
| `createdAt` | `timestamp().defaultNow().notNull()` | |
| `updatedAt` | `timestamp().defaultNow().notNull()` | |

#### SQFT Surcharge Rules (`sqft_surcharge_rules`)

| Table Name | `sqft_surcharge_rules` | Defines surcharges based on property square footage. |
| :--- | :--- | :--- |
| `id` | `uuid().primaryKey().defaultRandom()` | |
| `rangeStart` | `integer().notNull()` | Beginning of the square footage range (inclusive). |
| `rangeEnd` | `integer().notNull()` | End of the square footage range (inclusive). |
| `surchargeCents` | `integer().notNull()` | Surcharge amount in cents. |
| `isCustomQuote` | `boolean().default(false).notNull()` | Flag if the range requires a custom quote. |
| `createdAt` | `timestamp().defaultNow().notNull()` | |
| `updatedAt` | `timestamp().defaultNow().notNull()` | |

#### Laundry Pricing Rules (`laundry_pricing_rules`)

| Table Name | `laundry_pricing_rules` | Defines pricing and cleaner bonus for laundry services. |
| :--- | :--- | :--- |
| `id` | `uuid().primaryKey().defaultRandom()` | |
| `serviceType` | `varchar().notNull().unique()` | Enum: `In-Unit`, `Off-Site`. Unique. |
| `customerRevenueBaseCents` | `integer().notNull()` | Base revenue for the customer for this service type. |
| `customerRevenuePerLoadCents` | `integer().notNull()` | Additional customer revenue per laundry load. |
| `cleanerBonusPerLoadCents` | `integer().notNull()` | Bonus paid to the cleaner per laundry load. |
| `createdAt` | `timestamp().defaultNow().notNull()` | |
| `updatedAt` | `timestamp().defaultNow().notNull()` | |

#### Hot Tub Pricing Rules (`hot_tub_pricing_rules`)

| Table Name | `hot_tub_pricing_rules` | Defines pricing and time estimates for hot tub services. |
| :--- | :--- | :--- |
| `id` | `uuid().primaryKey().defaultRandom()` | |
| `serviceType` | `varchar().notNull().unique()` | Enum: `Basic`, `Full_Drain`. Unique. |
| `customerRevenueCents` | `integer().notNull()` | Customer revenue for this service type. |
| `timeAddHours` | `decimal(4, 3).notNull()` | Extra time added to the job for this service (in hours). |
| `createdAt` | `timestamp().defaultNow().notNull()` | |
| `updatedAt` | `timestamp().defaultNow().notNull()` | |

---

### `relationships.schema.ts`

This file defines the relational structure between your schemas for Drizzle's relational queries.

#### Key Relationships Overview

| Table | Relationship | Target Table(s) | Notes |
| :--- | :--- | :--- | :--- |
| **`customers`** | `many` | `properties`, `subscriptions` | A customer can have multiple properties and subscriptions. |
| **`properties`** | `one` | `customers` | A property belongs to one customer. |
| | `many` | `checklistFiles`, `subscriptions` | A property can have multiple files and subscriptions. |
| **`checklistFiles`** | `one` | `properties` | A checklist file belongs to one property. |
| **`subscriptions`** | `one` | `customers`, `properties` | A subscription belongs to one customer and one property. |
| | `many` | `jobs` | A subscription generates many cleaning jobs. |
| **`jobs`** | `one` | `subscriptions`, `properties` | A job is linked to one subscription and one property. |
| | `one` | `evidencePacket` | A job has one associated evidence packet. |
| | `many` | `payouts`, `jobsToCleaners` | A job can result in multiple payouts and is linked to multiple cleaners (via join table). |
| **`cleaners`** | `many` | `availabilities`, `payouts`, `jobsToCleaners` | A cleaner has multiple availabilities, payouts, and is linked to multiple jobs (via join table). |
| **`jobsToCleaners`** | `one` | `jobs`, `cleaners` | The join table links one job to one cleaner with a specific `role`. |
| **`evidencePackets`** | `one` | `jobs` | An evidence packet belongs to one job. |
| **`payouts`** | `one` | `cleaners`, `jobs` | A payout is for one cleaner and one job. |
| **`availability`** | `one` | `cleaners` | Availability is set for one cleaner. |


### `users.schema.ts`

This schema defines the **`users`** table, typically used for administrative or internal user accounts, and links them to an external authentication service like Supabase.

| Component | Detail | Notes |
| :--- | :--- | :--- |
| **Table Name** | `users` | Stores system users, distinct from `customers` or `cleaners`. |
| **Table Columns** | | |
| `id` | `uuid().primaryKey().defaultRandom()` | Unique primary key for the user. |
| `supabaseUserId` | `uuid().notNull().unique()` | **Foreign Key** to the external authentication service user ID. Must be unique. |
| `role` | `text().default('user').notNull()` | The user's role (e.g., 'admin', 'user', 'dispatcher'). |
| `email` | `varchar(255).notNull().unique()` | User's email address, must be unique. Indexed. |
| `name` | `varchar(255).nullable()` | Full name of the user. Indexed. |
| `createdAt` | `timestamp().defaultNow().notNull()` | Timestamp of creation. |
| `updatedAt` | `timestamp().defaultNow().notNull()` | Timestamp of last update. |
| **Indexes** | `users_email_idx` | Index on `email` for fast lookups. |
| | `users_name_idx` | Index on `name`. |
| **Schema/Types** | `insertUserSchema`, `selectUserSchema`, `updateUserSchema` | Zod schemas for validation. `User`, `NewUser`, `UpdateUser` types. |

---

### `availability.schema.ts`

This schema defines the **`availability`** table, tracking the daily availability and on-call status reported by a specific cleaner.

| Component | Detail | Notes |
| :--- | :--- | :--- |
| **Table Name** | `availability` | Daily availability records for cleaners. |
| **Enums** | `availabilityStatusEnum` | Values: `yes`, `no`. For general availability. |
| | `onCallAvailabilityEnum` | Values: `yes`, `no`. For on-call willingness. |
| **Table Columns** | | |
| `id` | `uuid().primaryKey().defaultRandom()` | Unique primary key. |
| `cleanerId` | `uuid().notNull()` | **Foreign Key** to `cleaners.id`. On Delete: `cascade`. Part of compound index. |
| `date` | `date().notNull()` | The specific date the availability applies to. Part of compound index. |
| `availabilityStatus` | `pgEnum('availability_status').notNull()` | The cleaner's general availability for the day. |
| `onCallStatus` | `pgEnum('on_call_status').notNull()` | The cleaner's on-call availability for the day. |
| `isGracePeriod` | `boolean().default(false)` | Flag indicating if the availability was submitted during a late/grace period. |
| `submittedTimestamp` | `timestamp().defaultNow().notNull()` | When the cleaner submitted this availability record. |
| `createdAt` | `timestamp().defaultNow().notNull()` | Timestamp of creation. |
| **Indexes** | `availabilityDateIdx` | Compound index on `(date, cleanerId)` for efficient daily scheduling lookups. |

---

### `evidencePackets.schema.ts`

This schema defines the **`evidence_packets`** table, storing all necessary proofs and data collected by the cleaner at the time of a job.

| Component | Detail | Notes |
| :--- | :--- | :--- |
| **Table Name** | `evidence_packets` | Contains proof of work for a job. |
| **Enums** | `evidencePacketStatusEnum` | Values: `complete`, `incomplete`, `pending_review`. Indexed. |
| **Table Columns** | | |
| `id` | `uuid().primaryKey().defaultRandom()` | Unique primary key. |
| `jobId` | `uuid().notNull().unique()` | **Foreign Key** to `jobs.id`. On Delete: `set null`. Must be unique (1 packet per job). |
| `photoUrls` | `text().array().nullable()` | Array of URLs for 'before and after' photos. |
| `isChecklistComplete` | `boolean().default(false)` | Flag indicating if the cleaning checklist was fully marked off. |
| `checklistLog` | `jsonb().nullable()` | JSON log of all checklist items and their status/timestamps. |
| `gpsCheckInTimestamp` | `timestamp(withTimezone: true).nullable()` | Time the cleaner's GPS confirmed check-in. |
| `gpsCheckOutTimestamp` | `timestamp(withTimezone: true).nullable()` | Time the cleaner's GPS confirmed check-out. |
| `cleanerNotes` | `text().nullable()` | Any notes submitted by the cleaner after the job. |
| `status` | `pgEnum('evidence_packet_status').default('pending_review')` | The review status of the packet. Indexed. |
| `createdAt` | `timestamp().defaultNow().notNull()` | Timestamp of creation. |
| `updatedAt` | `timestamp().defaultNow().notNull()` | Timestamp of last update. |
| **Indexes** | `statusIdx` | Index on `status` for fast querying of packets needing review or that are complete (for payout processing). |
