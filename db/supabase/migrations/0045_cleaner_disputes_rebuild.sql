-- Cleaner disputes table, enums, indexes, and access policies.
-- This replaces the unapplied 0005 migration with idempotent DDL.

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

CREATE TABLE IF NOT EXISTS "disputes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "cleaner_id" uuid NOT NULL REFERENCES "cleaners"("id") ON DELETE CASCADE,
  "type" "dispute_type" NOT NULL,
  "description" text NOT NULL,
  "status" "dispute_status" DEFAULT 'pending' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "disputes"
  ADD COLUMN IF NOT EXISTS "job_id" uuid REFERENCES "jobs"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "disputes_cleaner_idx" ON "disputes" ("cleaner_id");
CREATE INDEX IF NOT EXISTS "disputes_status_idx" ON "disputes" ("status");
CREATE INDEX IF NOT EXISTS "disputes_job_idx" ON "disputes" ("job_id");

ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;

-- Resolve auth.uid() through users; cleaners.user_id is not an auth uid.
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

REVOKE ALL ON public.disputes FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.disputes FROM authenticated;

COMMENT ON TABLE "disputes" IS
  'Cleaner-filed disputes about pay, reliability score, or job assignment.';
COMMENT ON COLUMN "disputes"."job_id" IS
  'Optional related job. Kept when a job is deleted.';
