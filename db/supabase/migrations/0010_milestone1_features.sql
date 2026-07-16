-- Milestone 1 feature schema changes.
-- Idempotent (safe to re-run) to match this repo's hand-applied migration style.
-- NOTE: subscriptions.status gains 'paused' at the app layer only (Drizzle
-- varchar enum, not a Postgres enum) so no DB change is needed there.

-- 1.9 — per-property cleaner hierarchy -------------------------------------
DO $$ BEGIN
  CREATE TYPE "property_cleaner_tier" AS ENUM (
    'main_primary', 'secondary_primary', 'preferred_backup', 'on_call'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "property_cleaners" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "property_id" uuid NOT NULL REFERENCES "properties"("id") ON DELETE cascade,
  "cleaner_id" uuid NOT NULL REFERENCES "cleaners"("id") ON DELETE cascade,
  "tier" "property_cleaner_tier" NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "property_cleaners_property_cleaner_unique" UNIQUE ("property_id", "cleaner_id")
);
CREATE INDEX IF NOT EXISTS "property_cleaners_property_idx" ON "property_cleaners" ("property_id");
CREATE INDEX IF NOT EXISTS "property_cleaners_cleaner_idx" ON "property_cleaners" ("cleaner_id");

-- 1.10 — GPS location + geofence + on-time on evidence packets --------------
ALTER TABLE "evidence_packets" ADD COLUMN IF NOT EXISTS "check_in_latitude" numeric(10, 8);
ALTER TABLE "evidence_packets" ADD COLUMN IF NOT EXISTS "check_in_longitude" numeric(11, 8);
ALTER TABLE "evidence_packets" ADD COLUMN IF NOT EXISTS "check_in_accuracy_meters" numeric(8, 2);
ALTER TABLE "evidence_packets" ADD COLUMN IF NOT EXISTS "check_in_distance_miles" numeric(8, 3);
ALTER TABLE "evidence_packets" ADD COLUMN IF NOT EXISTS "check_in_within_geofence" boolean;
ALTER TABLE "evidence_packets" ADD COLUMN IF NOT EXISTS "check_out_latitude" numeric(10, 8);
ALTER TABLE "evidence_packets" ADD COLUMN IF NOT EXISTS "check_out_longitude" numeric(11, 8);
ALTER TABLE "evidence_packets" ADD COLUMN IF NOT EXISTS "check_out_accuracy_meters" numeric(8, 2);
ALTER TABLE "evidence_packets" ADD COLUMN IF NOT EXISTS "check_out_distance_miles" numeric(8, 3);
ALTER TABLE "evidence_packets" ADD COLUMN IF NOT EXISTS "check_out_within_geofence" boolean;
ALTER TABLE "evidence_packets" ADD COLUMN IF NOT EXISTS "arrival_delay_minutes" integer;
ALTER TABLE "evidence_packets" ADD COLUMN IF NOT EXISTS "arrival_on_time" boolean;

-- 1.11 — per-cleaner pay rate + late-arrival pay deduction ------------------
ALTER TABLE "cleaners" ADD COLUMN IF NOT EXISTS "hourly_rate_cents" integer DEFAULT 1700 NOT NULL;
ALTER TABLE "cleaners" ADD COLUMN IF NOT EXISTS "hire_date" date;
ALTER TABLE "cleaners" ADD COLUMN IF NOT EXISTS "rate_reviewed_at" date;
ALTER TABLE "payouts" ADD COLUMN IF NOT EXISTS "late_deduction_amount" numeric(10, 2);

-- 1.12 — customer ratings ---------------------------------------------------
CREATE TABLE IF NOT EXISTS "ratings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job_id" uuid NOT NULL UNIQUE REFERENCES "jobs"("id") ON DELETE cascade,
  "cleaner_id" uuid NOT NULL REFERENCES "cleaners"("id") ON DELETE cascade,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE cascade,
  "stars" integer NOT NULL,
  "comment" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "ratings_cleaner_idx" ON "ratings" ("cleaner_id");
CREATE INDEX IF NOT EXISTS "ratings_customer_idx" ON "ratings" ("customer_id");

-- 1.13 — new in-app notification types -------------------------------------
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'dispute_update';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'assignment';

-- 1.15 — legal document e-signature name -----------------------------------
ALTER TABLE "onboarding_documents" ADD COLUMN IF NOT EXISTS "signed_name" text;
