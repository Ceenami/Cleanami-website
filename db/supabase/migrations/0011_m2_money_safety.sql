-- Milestone 2 — money-route safety + data-retention support.
-- Idempotent (safe to re-run) to match this repo's hand-applied migration style.
-- The drizzle-kit meta snapshot is stale; this migration is hand-written and is
-- NOT produced by `drizzle-kit generate`.

-- 2.2 / 2.9 — Stripe webhook + payment-event dedupe ledger -------------------
-- One row per Stripe event id we have durably processed. The webhook and money
-- crons check/insert here to make event handling idempotent (skip replays).
CREATE TABLE IF NOT EXISTS "processed_stripe_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" text NOT NULL,
  "event_type" text NOT NULL,
  "processed_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "processed_stripe_events_event_id_key"
  ON "processed_stripe_events" ("event_id");

-- 2.2 / PAY-3 — prevent duplicate payouts for the same (job, cleaner) --------
-- Defensive dedupe first so the unique index can be created even if a duplicate
-- slipped in before this constraint existed. Keeps the earliest row per pair.
DELETE FROM "payouts" p
USING "payouts" q
WHERE p.job_id = q.job_id
  AND p.cleaner_id = q.cleaner_id
  AND p.created_at > q.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS "payouts_job_cleaner_key"
  ON "payouts" ("job_id", "cleaner_id");

-- 2.2 — row-claim locking for the payout cron ------------------------------
-- Set when a cron run claims a pending payout, immediately before the Stripe
-- transfer, so concurrent runs can't both process the same row. Combined with a
-- deterministic transfer idempotency key this makes payouts double-pay-safe.
ALTER TABLE "payouts" ADD COLUMN IF NOT EXISTS "processing_started_at" timestamp;

-- 2.2 — fix the stripe_payout_id sentinel collision --------------------------
-- The "skipped_owner_direct_payment" sentinel was written into the UNIQUE
-- stripe_payout_id column, so a second owner-skip payout would collide on it.
-- Null it out (Postgres treats NULLs as distinct in a UNIQUE index, so multiple
-- NULLs are allowed). The writer is updated to store NULL going forward.
UPDATE "payouts"
  SET "stripe_payout_id" = NULL
  WHERE "stripe_payout_id" = 'skipped_owner_direct_payment';

-- 2.10 — data retention: track customer PII anonymization --------------------
-- Financial rows are retained; PII is anonymized after the retention window.
-- This column makes the retention job idempotent (skip already-anonymized rows).
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "anonymized_at" timestamp;
