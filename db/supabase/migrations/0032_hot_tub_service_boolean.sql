-- properties.hot_tub_service was `character varying`, while
-- db/schemas/properties.schema.ts has always declared it
-- `boolean(...).default(false).notNull()`.
--
-- Every writer passes a real boolean, so Postgres coerced it on the way in and
-- the column ended up holding the STRINGS 'true' / 'false' / NULL. Readers get
-- those strings back, and `calculateJobStaffing()` gates hot-tub time on
--
--     input.hotTubServiceLevel && propertySize !== "custom"
--
-- where the string 'false' is TRUTHY. A property with no hot tub therefore
-- collected +0.333 h (or +1.0 h deep-clean) of hot-tub time, inflating both the
-- customer's price and every assigned cleaner's pay by ~$5.61 per cleaner.
--
-- Effect of this migration on existing rows:
--   'true'  -> true   (unchanged behaviour; these really do have hot tubs)
--   'false' -> false  (THE FIX: stops charging hot-tub time on 3 properties)
--   NULL    -> false  (unchanged behaviour; NULL was already falsy)
--
-- Historical jobs keep the expected_hours they were created with. This only
-- corrects what future pricing and staffing calculations produce.

ALTER TABLE public.properties
  ALTER COLUMN hot_tub_service DROP DEFAULT;

ALTER TABLE public.properties
  ALTER COLUMN hot_tub_service TYPE boolean
  USING (
    CASE
      WHEN hot_tub_service IS NULL THEN false
      WHEN lower(hot_tub_service::text) IN ('true', 't', '1') THEN true
      ELSE false
    END
  );

-- Hot-tub service on a property with no hot tub is not a meaningful state, and
-- it is the combination that made the truthiness bug reachable. Nothing matches
-- this today; it is here so the conversion cannot leave one behind.
UPDATE public.properties
SET hot_tub_service = false
WHERE has_hot_tub = false AND hot_tub_service = true;

ALTER TABLE public.properties
  ALTER COLUMN hot_tub_service SET DEFAULT false;

ALTER TABLE public.properties
  ALTER COLUMN hot_tub_service SET NOT NULL;

COMMENT ON COLUMN public.properties.hot_tub_service IS
  'Whether hot-tub servicing is included. Boolean since migration 0032 — it was varchar, and the string ''false'' read as truthy in the pricing engine.';
