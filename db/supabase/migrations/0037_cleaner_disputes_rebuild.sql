-- 0037 — cleaner disputes: the storage the application has always assumed.
--
-- NOT YET APPLIED TO PRODUCTION. Test project only; production migrations are
-- applied by hand after review, never by an agent. Safe to re-run — every
-- statement is idempotent and it has been applied twice against test with no
-- error.
--
-- WHY
-- This does not introduce a new concept. Every line of application code for
-- cleaner disputes already exists and has since 0005: the cleaner's submit
-- route, the admin list and detail routes, the PATCH that resolves one, the
-- admin tab, and the Drizzle table declaration. What has never existed is the
-- table. 0005_cleaner_disputes.sql was written and never applied — not to
-- production, and not to any test database either.
--
-- The consequence is two user-visible failures with one cause, both reproduced
-- on 2026-09-04 against the test project:
--
--   * a cleaner submitting a dispute gets HTTP 500 "Failed to submit dispute",
--     and NO row lands anywhere, because the INSERT is what raises
--     42P01 relation "disputes" does not exist;
--   * the admin disputes screen gets HTTP 500 "Failed to load disputes" from
--     the same missing relation. Admin authentication resolves correctly and
--     is not involved.
--
-- Nobody has ever filed a dispute, so there is no backlog of lost submissions
-- to recover: the insert never committed. An admin may reasonably assume the
-- opposite, which is worth saying out loud when this is deployed.
--
-- WHY NOT SIMPLY RE-RUN 0005
-- 0005 opens with two bare CREATE TYPE statements. Postgres has no
-- CREATE TYPE ... IF NOT EXISTS, so on any database where either type already
-- exists the file aborts — and its CREATE TABLE sits after both of them, so an
-- aborted run leaves the types without the table. That is one plausible
-- account of how this repo reached its current state, and it is reason enough
-- not to repeat the shape. 0005 keeps its number and its place in the record;
-- it now carries a header saying it is superseded by this file.
--
-- WHAT THIS ADDS OVER 0005
--   1. Guarded DDL throughout, so re-running is harmless.
--   2. job_id — the dispute's related job, nullable. The client's requirement
--      is that an admin sees "the cleaner, dispute type, description, date, and
--      related job if included"; "if included" is their own hedge, so the
--      column is optional by design. It is free to add at table-creation time
--      and awkward afterwards, and a pay dispute with no job reference is the
--      first thing an admin will complain about.
--   3. Row-level security, which 0005 never had.

-- ---------------------------------------------------------------------------
-- 1. The two enums. Guarded, because CREATE TYPE has no IF NOT EXISTS form.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  CREATE TYPE "public"."dispute_type" AS ENUM ('pay', 'reliability_score', 'job_assignment');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "public"."dispute_status" AS ENUM ('pending', 'resolved', 'denied');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2. The table. Same shape as 0005 so the existing Drizzle declaration and
--    every query written against it keep working unchanged.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "disputes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- ON DELETE CASCADE: a dispute is meaningless without the cleaner who filed
  -- it, and cleaner rows are not purged in the ordinary course of business.
  "cleaner_id" uuid NOT NULL REFERENCES "cleaners"("id") ON DELETE CASCADE,
  "type" "dispute_type" NOT NULL,
  "description" text NOT NULL,
  "status" "dispute_status" DEFAULT 'pending' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Added as a separate statement rather than inside the CREATE TABLE, so this
-- file is still correct on a database where an earlier attempt created the
-- table without it.
--
-- ON DELETE SET NULL, not CASCADE: deleting a job must never destroy the
-- record of a pay dispute about it. The dispute outlives its job and simply
-- loses the link.
ALTER TABLE "disputes"
  ADD COLUMN IF NOT EXISTS "job_id" uuid REFERENCES "jobs"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "disputes_cleaner_idx" ON "disputes" ("cleaner_id");
CREATE INDEX IF NOT EXISTS "disputes_status_idx"  ON "disputes" ("status");
CREATE INDEX IF NOT EXISTS "disputes_job_idx"     ON "disputes" ("job_id");

-- ---------------------------------------------------------------------------
-- 3. RLS. Every write goes through the website's authenticated API over
--    Drizzle (the `postgres` role, which bypasses RLS). The SELECT policy
--    exists so the native cleaner app can read a cleaner's own disputes over
--    PostgREST later without re-opening the table; it must NOT be able to
--    write them directly. A cleaner who can write dispute rows straight to the
--    database can also resolve them, which is the self-reported-accountability
--    trap this project has already paid for once.
-- ---------------------------------------------------------------------------
ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;

-- NOTE on the identity join: `cleaners.user_id` references `users.id`, the
-- app's own user row — NOT the Supabase auth uid, which lives in
-- `users.supabase_user_id` (lib/cleaner-auth.ts resolves the cleaner in
-- exactly these two hops). Older policies in this repo compare
-- `cleaners.user_id` directly against `auth.uid()`, which can never match and
-- therefore always denies. That fails closed, so it is not a hole — but it is
-- why this policy joins through `users` instead of copying that shape.
DROP POLICY IF EXISTS disputes_select_own_or_admin ON public.disputes;
CREATE POLICY disputes_select_own_or_admin ON public.disputes
  FOR SELECT TO authenticated
  USING (
    is_app_admin()
    OR cleaner_id IN (
      SELECT c.id
      FROM public.cleaners c
      JOIN public.users u ON u.id = c.user_id
      WHERE u.supabase_user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS disputes_admin_write ON public.disputes;
CREATE POLICY disputes_admin_write ON public.disputes
  FOR ALL TO authenticated USING (is_app_admin()) WITH CHECK (is_app_admin());

-- Belt and braces: re-assert the posture for this table rather than relying on
-- the altered default privileges having been applied.
REVOKE ALL ON public.disputes FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.disputes FROM authenticated;

-- ---------------------------------------------------------------------------
-- 4. Column comments — the only place this reasoning reaches someone who has
--    the database and not the repo.
-- ---------------------------------------------------------------------------
COMMENT ON TABLE "disputes" IS
  'Cleaner-filed disputes about pay, reliability score or job assignment. Cleaner-filed ONLY: this is not a customer complaint system and has no customer-facing entry point.';

COMMENT ON COLUMN "disputes"."type" IS
  'pay, reliability_score or job_assignment. The three the cleaner UI offers; the submit route validates against the same list.';

COMMENT ON COLUMN "disputes"."status" IS
  'pending on submit; an admin moves it to resolved or denied. There is no in-progress state and no SLA timer.';

COMMENT ON COLUMN "disputes"."job_id" IS
  'The job this dispute is about, when the cleaner named one. Nullable by design — a reliability-score dispute often has no single job. ON DELETE SET NULL so purging a job never destroys the dispute.';

-- What to check after applying (all must hold):
--   \d disputes                                                  -- table, job_id, 3 indexes
--   SELECT unnest(enum_range(NULL::dispute_type));               -- pay/reliability_score/job_assignment
--   SELECT unnest(enum_range(NULL::dispute_status));             -- pending/resolved/denied
--   SELECT relrowsecurity FROM pg_class WHERE relname='disputes';-- t
--   SELECT count(*) FROM disputes;                               -- 0, and it must not error
--
-- Apply with (hand this to a human, do not run it):
--   psql "$PRODUCTION_DATABASE_URL" -f db/supabase/migrations/0037_cleaner_disputes_rebuild.sql
