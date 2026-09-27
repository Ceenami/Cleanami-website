-- Cleaner availability hotfix: durable submission state for the admin staffing view.
--
-- `availability` intentionally stores positive daily availability only. Without
-- this companion table an empty submission and a missed submission are
-- indistinguishable, and a full edit destroys the only submitted_at evidence.

CREATE TYPE "public"."availability_submission_mode" AS ENUM ('full', 'override');

CREATE TABLE "cleaner_availability_submissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "cleaner_id" uuid NOT NULL,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "submission_mode" "availability_submission_mode" DEFAULT 'full' NOT NULL,
  "first_submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cleaner_availability_submissions_period_end_check"
    CHECK ("period_end" = "period_start" + 13),
  CONSTRAINT "cleaner_availability_submissions_cleaner_id_cleaners_id_fk"
    FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "cleaner_availability_submissions_period_unique"
    UNIQUE("cleaner_id", "period_start")
);

CREATE INDEX "cleaner_availability_submissions_period_idx"
  ON "cleaner_availability_submissions" USING btree ("period_start", "period_end");

-- This table can be exposed through Supabase's Data API; make access explicit
-- rather than relying on project default grants. The web app uses a server-side
-- DB connection, but the policies keep direct authenticated access safe too.
ALTER TABLE "public"."cleaner_availability_submissions" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON "public"."cleaner_availability_submissions" TO authenticated;

CREATE POLICY "cleaner_availability_submissions_owner_or_admin"
  ON "public"."cleaner_availability_submissions"
  FOR ALL TO authenticated
  USING (
    "cleaner_id" = public.current_cleaner_id() OR public.is_app_admin()
  )
  WITH CHECK (
    "cleaner_id" = public.current_cleaner_id() OR public.is_app_admin()
  );
