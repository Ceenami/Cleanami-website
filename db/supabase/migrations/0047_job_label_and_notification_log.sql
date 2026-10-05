-- Job labels and notification attempt logging.

ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "job_label" varchar;

ALTER TABLE "jobs" DROP CONSTRAINT IF EXISTS "jobs_job_label_check";
ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_job_label_check"
  CHECK ("job_label" IS NULL OR "job_label" IN ('reclean', 'correction'));

COMMENT ON COLUMN "jobs"."job_label" IS
  'Optional reason for a reclean or correction job.';

CREATE TABLE IF NOT EXISTS "notification_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "channel" varchar NOT NULL,
  "trigger" text NOT NULL,
  "recipient" text,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "job_id" uuid REFERENCES "jobs"("id") ON DELETE SET NULL,
  "status" varchar NOT NULL,
  "error" text,
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

CREATE INDEX IF NOT EXISTS "notification_log_trigger_created_idx"
  ON "notification_log" ("trigger", "created_at" DESC);

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_log_admin_read ON public.notification_log;
CREATE POLICY notification_log_admin_read ON public.notification_log
  FOR SELECT TO authenticated USING (is_app_admin());

REVOKE ALL ON public.notification_log FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.notification_log FROM authenticated;

COMMENT ON TABLE "notification_log" IS
  'Notification send attempts. Do not store message bodies or property access details.';
