-- 0034 — laundry loads must accompany a laundry service
--
-- ============================ DO NOT APPLY YET ============================
-- This migration is written but deliberately NOT hand-applied. See the
-- "Before applying" section at the bottom.
-- ==========================================================================
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

-- Before applying:
--   1. Run `node _testing/report-laundry-loads-gaps.mjs` (read-only) and send
--      the list to the client.
--   2. Have the client supply the real per-property load estimate. Do NOT
--      backfill from the size table — that changes what a live customer is
--      billed on their next clean.
--   3. Apply this file.
--   4. Then, once no rows violate it, promote the constraint:
--        ALTER TABLE "properties" VALIDATE CONSTRAINT "properties_laundry_loads_required";
