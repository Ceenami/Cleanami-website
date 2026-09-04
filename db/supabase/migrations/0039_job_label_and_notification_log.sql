-- 0039 — jobs.job_label, and the notification send log.
--
-- NOT YET APPLIED TO PRODUCTION. Test project only; production migrations are
-- applied by hand after review, never by an agent. Safe to re-run — every
-- statement is idempotent and it has been applied twice against test with no
-- error.
--
-- WHY THESE TWO TOGETHER
-- They are the two additive objects in this phase that nothing else depends
-- on. Neither references the enum value added in 0038, so this file has no
-- ordering hazard of its own; it is numbered after it only to keep the applied
-- sequence readable.
--
-- Both degrade to today's behaviour when absent: job_label is nullable and
-- renders as the service type when it is not set, and the send log is
-- best-effort — a failed insert into it must never fail a send, so a database
-- without the table loses evidence, not behaviour.

-- ---------------------------------------------------------------------------
-- 1. jobs.job_label — why this job exists, which is not what kind of job it is.
--
-- An admin creating a make-good clean needs to mark it as one. A reclean of a
-- vacation-rental turnover is still a vacation-rental job: its TYPE and its
-- REASON are different facts, and collapsing them into service_type would
-- corrupt the service-type filter that shipped in 0035.
--
-- Rendering rule, everywhere a service type is displayed: show the job_label's
-- display text when set, otherwise the service_type's. The three customer-
-- facing literals are the client's own wording — "Vacation Rental Turnover",
-- "One-Time Residential Clean", "Reclean/Correction" — and, as with 0035, the
-- display labels live in the application and only the stored literals are here.
--
-- varchar + CHECK rather than a pgEnum, for the same reason as 0035's
-- service_type: a value added by ALTER TYPE cannot be used until its
-- transaction commits, which makes add-then-backfill impossible in one file.
--
-- Nullable, NO default and NO backfill. Every job that exists today is an
-- ordinary job; inventing a label for them would be a lie the admin list then
-- displays as fact.
--
-- No index. job_label is read on a row already in hand, never filtered at
-- scale — unlike service_type, which has jobs_service_type_idx and keeps it.
-- ---------------------------------------------------------------------------
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "job_label" varchar;

ALTER TABLE "jobs" DROP CONSTRAINT IF EXISTS "jobs_job_label_check";
ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_job_label_check"
  CHECK ("job_label" IS NULL OR "job_label" IN ('reclean', 'correction'));

COMMENT ON COLUMN "jobs"."job_label" IS
  'Why this job exists — reclean or correction — as opposed to what kind of clean it is, which is service_type. NULL for every ordinary job, which is nearly all of them. Displayed in place of the service-type label when set.';

-- ---------------------------------------------------------------------------
-- 2. notification_log — what actually left the process.
--
-- The question this answers is "which notifications are really sending?", and
-- it cannot be answered by reading code: a call site can be added without a
-- log and nothing would notice. So the writes go inside the four channel
-- services, not at the roughly thirty call sites, precisely so the log cannot
-- be lied to.
--
-- IT RECORDS THE ATTEMPT AND ITS OUTCOME, NOT THE DELIVERY. Handing a message
-- to a provider is not the same as a human receiving it. A delivery webhook is
-- the next thing after this table, not part of it.
--
-- 'skipped' is the load-bearing status. When a provider key is unset every
-- channel degrades gracefully and sends nothing — which is correct, and is also
-- exactly why "unconfigured" and "never triggered" are indistinguishable today.
-- A row saying status='skipped', error='RESEND_API_KEY not configured' tells
-- those two apart, and they are the two answers the client is asking us for.
--
-- PERSONAL DATA, AND WHAT MUST NEVER LAND HERE. `recipient` holds an address,
-- a phone number or a user id, and that is the most this table may know about
-- a person. Never store a message body. Never store anything derived from
-- properties.entry_instructions — that column is a credential store holding
-- door, lockbox, gate and garage codes, and this is a new surface that could
-- quietly violate the rule that keeps them out of notifications.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "notification_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "channel" varchar NOT NULL,
  -- The event, e.g. 'residential_booking_confirmation'. This is the column the
  -- client's question is answered by counting.
  "trigger" text NOT NULL,
  "recipient" text,
  -- Nullable: an email can precede an account, and an admin fan-out addresses
  -- people who may not have a users row yet.
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  -- ON DELETE SET NULL, never CASCADE: deleting a job must orphan its send
  -- history, not erase it.
  "job_id" uuid REFERENCES "jobs"("id") ON DELETE SET NULL,
  "status" varchar NOT NULL,
  "error" text,
  -- The provider's own id (Resend / Twilio). Added now and left NULL for the
  -- whole of this phase: it costs nothing at table-creation time and is the one
  -- thing a delivery webhook would later need. Adding a column to a busy log
  -- table afterwards is the more expensive move.
  "provider_message_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "notification_log" DROP CONSTRAINT IF EXISTS "notification_log_channel_check";
ALTER TABLE "notification_log"
  ADD CONSTRAINT "notification_log_channel_check"
  CHECK ("channel" IN ('email', 'sms', 'push', 'in_app'));

ALTER TABLE "notification_log" DROP CONSTRAINT IF EXISTS "notification_log_status_check";
ALTER TABLE "notification_log"
  ADD CONSTRAINT "notification_log_status_check"
  CHECK ("status" IN ('sent', 'failed', 'skipped'));

-- The one query this table exists to serve: "how many of each trigger fired,
-- most recent first". Nothing else needs an index.
CREATE INDEX IF NOT EXISTS "notification_log_trigger_created_idx"
  ON "notification_log" ("trigger", "created_at" DESC);

-- ---------------------------------------------------------------------------
-- 3. RLS. Nothing outside the server has any business reading this: it is an
--    operational log containing recipient addresses. No SELECT policy is
--    granted to `authenticated` at all, which means RLS denies everyone except
--    the `postgres` role the application connects as.
-- ---------------------------------------------------------------------------
ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_log_admin_read ON public.notification_log;
CREATE POLICY notification_log_admin_read ON public.notification_log
  FOR SELECT TO authenticated USING (is_app_admin());

REVOKE ALL ON public.notification_log FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.notification_log FROM authenticated;

COMMENT ON TABLE "notification_log" IS
  'One row per notification ATTEMPT, written inside the channel services. Records that a message was handed to a provider (or skipped, or failed) — NOT that anyone received it. Never store message bodies here, and never anything derived from properties.entry_instructions.';

COMMENT ON COLUMN "notification_log"."trigger" IS
  'The event that caused the send, e.g. residential_booking_confirmation. Counting this column is how "which notifications actually send?" gets answered.';

COMMENT ON COLUMN "notification_log"."status" IS
  'sent = handed to the provider without error. failed = the provider rejected it. skipped = no attempt was made, almost always because the channel is unconfigured; the reason goes in error. skipped is what distinguishes "unconfigured" from "never triggered".';

COMMENT ON COLUMN "notification_log"."recipient" IS
  'Email address, phone number or user id. The most this table may know about a person. Never a message body.';

COMMENT ON COLUMN "notification_log"."provider_message_id" IS
  'Resend or Twilio message id. Nullable and unwritten for now; it is what a future delivery-confirmation webhook would match on.';

-- What to check after applying (all must hold):
--   \d jobs                                          -- job_label present, nullable
--   INSERT INTO jobs (job_label) VALUES ('foo');     -- must FAIL the CHECK
--   SELECT count(*) FROM jobs WHERE job_label IS NOT NULL;   -- 0, nothing backfilled
--   \d notification_log                              -- table + notification_log_trigger_created_idx
--   SELECT relrowsecurity FROM pg_class WHERE relname='notification_log';  -- t
--
-- Apply with (hand this to a human, do not run it):
--   psql "$PRODUCTION_DATABASE_URL" -f db/supabase/migrations/0039_job_label_and_notification_log.sql
