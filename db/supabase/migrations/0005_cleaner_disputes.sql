-- SUPERSEDED BY 0043_cleaner_disputes_rebuild.sql. DO NOT APPLY THIS FILE.
--
-- This migration was written but never applied — not to production, and not to
-- any test database. Confirmed 2026-09-04 against both.
--
-- It cannot safely be applied now. The two CREATE TYPE statements below are
-- bare, and Postgres has no CREATE TYPE ... IF NOT EXISTS, so on any database
-- where either type already exists this file aborts — and the CREATE TABLE
-- comes after both of them, leaving the types without the table.
--
-- 0043 re-issues the same shape with guarded DDL, adds the nullable job_id, and
-- carries the row-level security this file never had. Apply that instead.
--
-- Kept, not deleted: a migration file is a record, and the next person to
-- wonder why the numbering has a hole deserves an answer.

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
