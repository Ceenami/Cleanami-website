-- 0041 — residential one-time cleans: service type, pets, entry/access, parking
--
-- NOT YET APPLIED TO PRODUCTION. Test project only; production migrations are
-- applied by hand after review, never by an agent. Safe to re-run — every
-- statement is idempotent and it has been applied twice against test with no
-- error.
--
-- WHY
-- Every row in jobs and properties is implicitly a vacation-rental turnover
-- today. The schema has no way to say "this is a one-time clean of somebody's
-- home", so the booking flow, the admin surfaces and the cleaner app cannot
-- tell the two apart. This adds that vocabulary and nothing else.
--
-- Additive only: no table rewritten, no column dropped, no type changed. Every
-- new column has a backfilled default meaning "carry on as before", so a
-- half-applied run degrades to today's behaviour rather than to nulls in the
-- pricing engine.
--
-- WHY varchar + CHECK RATHER THAN AN ENUM
-- ALTER TYPE ... ADD VALUE cannot use the new value until the transaction
-- commits, so a file that adds a value and then backfills with it fails. A
-- CHECK has neither that hazard nor the "you cannot remove a label" one, and it
-- matches the existing properties.laundry_type / subscriptions.status
-- precedent. The stored literals are the client's own wording; display labels
-- live in the application, not here.
--
-- WHAT IS DELIBERATELY NOT HERE
--   * no jobs.customer_id — a residential job reaches its customer through
--     jobs.property_id -> properties.customer_id, which every customer-scoped
--     read already uses.
--   * no subscription row for a residential clean, and no fake iCal data. A
--     one-clean subscription would put the job inside the cancellation sweep,
--     which hard-DELETEs any job whose UID is absent from its subscription's
--     feed — and a one-clean record has no feed. Leaving subscription_id NULL
--     is the fix, not a workaround.
--   * no residential_requests table. Under-48h bookings are refused outright
--     rather than queued, so there is no request to store.
--   * no notification_log and no job_label — both are Phase 2B.
--   * no properties.home_condition. That requirement was withdrawn; the signal
--     survives in "special notes".

-- ---------------------------------------------------------------------------
-- 1. properties — what kind of place this is, whether pets live there, and how
--    a cleaner gets in.
-- ---------------------------------------------------------------------------
ALTER TABLE "properties"
  ADD COLUMN IF NOT EXISTS "service_type" varchar
    NOT NULL DEFAULT 'vacation_rental_subscription';

ALTER TABLE "properties"
  ADD COLUMN IF NOT EXISTS "pets_allowed" boolean NOT NULL DEFAULT false;

-- Nullable with NO default, all three. An existing property has no entry
-- information, and inventing one would be a lie a cleaner acts on at 9am.
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "entry_method" varchar;
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "entry_instructions" text;
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "parking_instructions" text;
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "special_instructions" text;

ALTER TABLE "properties" DROP CONSTRAINT IF EXISTS "properties_service_type_check";
ALTER TABLE "properties"
  ADD CONSTRAINT "properties_service_type_check"
  CHECK ("service_type" IN ('vacation_rental_subscription', 'residential_one_time'));

-- The eight options, in the order the client listed them. NULL is
-- permitted and means "not recorded", which is what every existing row is.
ALTER TABLE "properties" DROP CONSTRAINT IF EXISTS "properties_entry_method_check";
ALTER TABLE "properties"
  ADD CONSTRAINT "properties_entry_method_check"
  CHECK (
    "entry_method" IS NULL
    OR "entry_method" IN (
      'smart_lock', 'lockbox', 'hidden_key', 'customer_present',
      'front_desk', 'garage_code', 'gate_code', 'other'
    )
  );

-- ---------------------------------------------------------------------------
-- 2. jobs — the same discriminator, frozen at creation, plus where the job
--    came from. Denormalised on purpose: the same-day conflict rule, the admin
--    filters and the assignment ordering all need a job's type without a join,
--    and a job's type must not follow its property if the property is later
--    edited (same reasoning as addons_snapshot).
-- ---------------------------------------------------------------------------
ALTER TABLE "jobs"
  ADD COLUMN IF NOT EXISTS "service_type" varchar
    NOT NULL DEFAULT 'vacation_rental_subscription';

ALTER TABLE "jobs"
  ADD COLUMN IF NOT EXISTS "job_source" varchar NOT NULL DEFAULT 'ical';

ALTER TABLE "jobs" DROP CONSTRAINT IF EXISTS "jobs_service_type_check";
ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_service_type_check"
  CHECK ("service_type" IN ('vacation_rental_subscription', 'residential_one_time'));

ALTER TABLE "jobs" DROP CONSTRAINT IF EXISTS "jobs_job_source_check";
ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_job_source_check"
  CHECK ("job_source" IN ('ical', 'manual', 'customer_one_off', 'public_residential_booking'));

CREATE INDEX IF NOT EXISTS "jobs_service_type_idx" ON "jobs" ("service_type");

-- ---------------------------------------------------------------------------
-- 3. cleaners — residential eligibility. Both default TRUE, deliberately.
-- ---------------------------------------------------------------------------
ALTER TABLE "cleaners"
  ADD COLUMN IF NOT EXISTS "residential_qualified" boolean NOT NULL DEFAULT true;

ALTER TABLE "cleaners"
  ADD COLUMN IF NOT EXISTS "pet_comfortable" boolean NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- 4. Backfill.
--
-- ADD COLUMN ... NOT NULL DEFAULT already fills every existing row, so the
-- service_type statements below are belt-and-braces — no-ops on a correctly
-- applied file, but they survive someone later splitting the column addition
-- from its default.
-- ---------------------------------------------------------------------------
UPDATE "properties" SET "service_type" = 'vacation_rental_subscription'
 WHERE "service_type" IS NULL;

UPDATE "jobs" SET "service_type" = 'vacation_rental_subscription'
 WHERE "service_type" IS NULL;

-- job_source is different: the default is a floor, not the answer. Two rules,
-- and their ORDER MATTERS.
--
--   1. A synthetic `oneoff_` UID is the signature of `bookOneOffClean()` —
--      a customer-portal one-off, prepaid, `subscription_id` already NULL.
--   2. Anything left with no subscription did not come from an iCal feed, so
--      calling it 'ical' would be a lie. It is a hand-made job.
--
-- A job WITH a subscription keeps the 'ical' default, which is correct: that is
-- how the overwhelming majority of the live rows were created.
--
-- Do not write these as `WHERE job_source IS NULL`. The column is NOT NULL
-- DEFAULT 'ical', so that can never match, and every subscription-less
-- non-oneoff job would silently keep 'ical'.
UPDATE "jobs" SET "job_source" = 'customer_one_off'
 WHERE "calendar_event_uid" LIKE 'oneoff_%';

UPDATE "jobs" SET "job_source" = 'manual'
 WHERE "subscription_id" IS NULL
   AND (
     "calendar_event_uid" IS NULL
     OR "calendar_event_uid" NOT LIKE 'oneoff_%'
   );

-- ---------------------------------------------------------------------------
-- 5. Column comments — the only place this reasoning reaches someone who has
--    the database and not the repo.
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN "properties"."service_type" IS
  'vacation_rental_subscription or residential_one_time. Values are the client''s own, from the 2026-08-27 counterproposal. Display labels live in the application.';

COMMENT ON COLUMN "properties"."pets_allowed" IS
  'Drives the $10/clean pet fee and the pet note shown to the cleaner. Applies to both service types.';

COMMENT ON COLUMN "properties"."entry_method" IS
  'How the cleaner gets in. NULL means not recorded, which is every property predating this migration.';

COMMENT ON COLUMN "properties"."entry_instructions" IS
  'CREDENTIAL STORE — holds door, lockbox, gate and garage codes. Never put this in an email, an SMS, a push payload, a notifications row, jobs.notes, jobs.addons_snapshot or Stripe metadata. Return it only to an admin or to the ASSIGNED cleaner.';

COMMENT ON COLUMN "properties"."parking_instructions" IS
  'Free text, both service types. Not a credential, unlike entry_instructions.';

COMMENT ON COLUMN "properties"."special_instructions" IS
  'The customer''s own free-text notes about the clean. NOT a credential: this is "the dog is friendly but barks", not a door code, and it renders beside the access details rather than inside them. It is also where a "the house is in rough shape" signal lands, now that the Heavy-condition question has been dropped.';

COMMENT ON COLUMN "jobs"."service_type" IS
  'Frozen at job creation and never followed back to the property, in the same spirit as addons_snapshot. Denormalised so the same-day conflict rule and the admin filters need no join.';

COMMENT ON COLUMN "jobs"."job_source" IS
  'Where the job came from, which is a different question from what kind of service it is. ical is the default because that is what nearly every historical row is.';

COMMENT ON COLUMN "cleaners"."residential_qualified" IS
  'Defaults TRUE on purpose: opt-out, not opt-in. Defaulting FALSE would ship residential with an empty assignable pool, which presents as a broken assignment engine rather than as a policy.';

COMMENT ON COLUMN "cleaners"."pet_comfortable" IS
  'Defaults TRUE for the same reason as residential_qualified. Admin-editable per cleaner.';

-- What to check after applying (all must hold):
--   SELECT count(*) FROM jobs       WHERE service_type <> 'vacation_rental_subscription';  -- 0
--   SELECT count(*) FROM properties WHERE service_type <> 'vacation_rental_subscription';  -- 0
--   SELECT count(*) FROM cleaners   WHERE residential_qualified IS NOT TRUE;               -- 0
--   SELECT count(*) FROM properties WHERE entry_method IS NOT NULL
--      OR entry_instructions IS NOT NULL OR parking_instructions IS NOT NULL
--      OR special_instructions IS NOT NULL;                                                -- 0
--   SELECT job_source, count(*) FROM jobs GROUP BY 1;
--     -- customer_one_off must equal the number of UIDs starting 'oneoff_'
--     -- manual must equal the number of subscription-less jobs whose UID is
--     -- NULL or does not start oneoff_
--     -- nothing should sit on the 'ical' default by accident
--
-- On production, run the job_source counts before and after. The test project's
-- job mix is synthetic and does not prove the backfill against production's
-- rows.
