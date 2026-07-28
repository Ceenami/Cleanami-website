-- Phase 7 / checklist upload coverage — allow a checklist "file" to be a
-- pasted link (e.g. a Google Sheet) instead of an uploaded storage object.
-- Idempotent; hand-written in this repo's migration style (not drizzle-kit gen).

ALTER TABLE "checklist_files"
  ALTER COLUMN "storage_path" DROP NOT NULL;

ALTER TABLE "checklist_files"
  ADD COLUMN IF NOT EXISTS "source_url" text;

-- Exactly one of storage_path (an uploaded file) or source_url (a pasted
-- link) must be set — never both, never neither.
ALTER TABLE "checklist_files"
  DROP CONSTRAINT IF EXISTS "checklist_files_storage_xor_url";
ALTER TABLE "checklist_files"
  ADD CONSTRAINT "checklist_files_storage_xor_url" CHECK (
    (storage_path IS NOT NULL AND source_url IS NULL)
    OR (storage_path IS NULL AND source_url IS NOT NULL)
  );
