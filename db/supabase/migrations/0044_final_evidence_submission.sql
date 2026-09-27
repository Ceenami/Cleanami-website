-- 0044 — preserve the distinction between physical departure and final evidence.
--
-- Applied manually to production on 2026-09-27, after migration 0043 (the
-- cleaner-availability submission-ledger hotfix). This mobile-readiness
-- migration is independent of the deferred Phase 2B migrations, which must
-- now be renumbered to 0045–0047 before their own promotion.
--
-- `gps_check_out_timestamp` is the recorded physical departure. The new field
-- is populated only when a complete checklist/photo packet is finalized, so a
-- later upload cannot make it appear that the cleaner was still at the property.

ALTER TABLE "evidence_packets"
  ADD COLUMN IF NOT EXISTS "final_evidence_submitted_at" timestamptz;

-- Before this migration, a packet could be marked complete only as part of the
-- old all-at-once checkout flow. Preserve those already-finalized packets so
-- the capture recovery cron can settle any legitimate legacy work.
UPDATE "evidence_packets"
SET "final_evidence_submitted_at" = COALESCE("gps_check_out_timestamp", "updated_at")
WHERE "final_evidence_submitted_at" IS NULL
  AND "status" = 'complete';

CREATE INDEX IF NOT EXISTS "evidence_packets_final_submission_idx"
  ON "evidence_packets" ("final_evidence_submitted_at")
  WHERE "final_evidence_submitted_at" IS NOT NULL;
