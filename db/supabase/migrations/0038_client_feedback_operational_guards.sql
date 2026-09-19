-- NOT YET APPLIED TO PRODUCTION.
-- A property has at most one Main Primary Cleaner.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.property_cleaners
    WHERE tier = 'main_primary'
    GROUP BY property_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce one Main Primary Cleaner: resolve duplicate property_cleaners rows first';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS property_cleaners_one_main_primary_per_property
  ON public.property_cleaners (property_id)
  WHERE tier = 'main_primary';
