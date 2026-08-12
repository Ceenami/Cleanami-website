-- 0034 — laundry loads must accompany a laundry service
--
-- ===================== APPLIED AND VALIDATED 2026-08-12 =====================
-- Applied to the shared Supabase project, then promoted with
--   ALTER TABLE "properties" VALIDATE CONSTRAINT "properties_laundry_loads_required";
-- after the 6 pre-existing violating rows were given load counts. `convalidated`
-- is true, so the NOT VALID caveat below is now historical — the constraint is
-- enforced on every row. Re-running this file is harmless (it drops and re-adds).
-- ============================================================================
--
-- WHY
-- `properties.laundry_loads` is nullable with no constraint, so a property can
-- carry `laundry_type = 'in_unit' | 'off_site'` with no load count. The pricing
-- engine multiplies the count by the per-load rate, so a NULL priced laundry at
-- $0 — and for off-site it also skipped the $20 base fee, because the base was
-- gated on `loads > 0`. The whole add-on billed as free.
--
-- The application now closes every write path (three zod schemas, plus
-- `createProperty`/`updateProperty`, which are the only places that see the
-- merged result of a partial PATCH). This constraint is defence-in-depth
-- against a future direct-SQL writer, not the fix for the reported bug.
--
-- WHY `NOT VALID`
-- A plain CHECK is validated against existing rows and would fail outright:
-- there are 6 rows in violation (see `_testing/report-laundry-loads-gaps.mjs`).
-- `NOT VALID` skips that back-check so the constraint can be added at all.
--
-- CAUTION: `NOT VALID` still enforces the check on every INSERT *and on every
-- UPDATE of an existing row*. Applying this before the 6 rows are corrected
-- would turn a silent data defect into hard failures on unrelated writes —
-- notably the lazy re-geocode in `updatePropertyCoordinates()` and the
-- `geocodeAllProperties()` backfill, both of which write to legacy rows.

ALTER TABLE "properties"
  DROP CONSTRAINT IF EXISTS "properties_laundry_loads_required";

ALTER TABLE "properties"
  ADD CONSTRAINT "properties_laundry_loads_required"
  CHECK (
    "laundry_type" NOT IN ('in_unit', 'off_site')
    OR ("laundry_loads" IS NOT NULL AND "laundry_loads" >= 1)
  )
  NOT VALID;

-- No semicolons inside this string, please: a naive statement splitter cuts the
-- literal in half and the whole file fails to apply.
COMMENT ON CONSTRAINT "properties_laundry_loads_required" ON "properties" IS
  'A laundry service requires a load count of at least 1. Loads drive the per-load customer charge. Added NOT VALID because pre-existing rows violate it.';

-- What was done (2026-08-12):
--   1. `node _testing/report-laundry-loads-gaps.mjs` listed the 6 violating
--      rows — all demo/test accounts, no third-party customer among them.
--   2. Each was given the v12 size-based load count (2/3/4). Safe here only
--      because they were demo accounts; for a live customer, get the real
--      estimate rather than inferring one, since it changes their next bill.
--   3. This file applied, then the constraint promoted with VALIDATE.
--
-- Note for a fresh environment: applying this against a database that still has
-- violating rows leaves the constraint NOT VALID, which still blocks unrelated
-- UPDATEs to those rows (the lazy re-geocode writes, for one). Clear the rows
-- first, then VALIDATE.
