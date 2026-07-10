CREATE TYPE "public"."dispute_type" AS ENUM('pay', 'reliability_score', 'job_assignment');
CREATE TYPE "public"."dispute_status" AS ENUM('pending', 'resolved', 'denied');

CREATE TABLE IF NOT EXISTS "disputes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "cleaner_id" uuid NOT NULL REFERENCES "cleaners"("id") ON DELETE CASCADE,
  "type" "dispute_type" NOT NULL,
  "description" text NOT NULL,
  "status" "dispute_status" DEFAULT 'pending' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "disputes_cleaner_idx" ON "disputes" ("cleaner_id");
CREATE INDEX IF NOT EXISTS "disputes_status_idx" ON "disputes" ("status");
