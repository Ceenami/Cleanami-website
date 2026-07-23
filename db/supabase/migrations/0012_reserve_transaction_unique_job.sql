-- Defect 4 — one reserve-ledger row per job.
-- Idempotent (safe to re-run) to match this repo's hand-applied migration style.
-- The drizzle-kit meta snapshot is stale; this migration is hand-written and is
-- NOT produced by `drizzle-kit generate`.

-- A job is captured once, so it must have exactly one reserve_transactions row.
-- A crash between the Stripe capture and the job status update let the capture
-- retry insert a second row, double-counting the 2% reserve hold in the ledger.
-- The capture path now inserts with ON CONFLICT (job_id) DO NOTHING, which needs
-- this unique constraint to be the safety net.

-- Defensive dedupe first so the unique index can be created even if a duplicate
-- was inserted before this constraint existed. Keeps the earliest row per job.
DELETE FROM "reserve_transactions" p
USING "reserve_transactions" q
WHERE p.job_id = q.job_id
  AND p.created_at > q.created_at;

-- Guard against an exact-timestamp tie (same created_at) that the delete above
-- would miss: keep the lowest id per job.
DELETE FROM "reserve_transactions" p
USING "reserve_transactions" q
WHERE p.job_id = q.job_id
  AND p.created_at = q.created_at
  AND p.id > q.id;

ALTER TABLE "reserve_transactions"
  DROP CONSTRAINT IF EXISTS "reserve_transactions_job_id_unique";
ALTER TABLE "reserve_transactions"
  ADD CONSTRAINT "reserve_transactions_job_id_unique" UNIQUE ("job_id");
