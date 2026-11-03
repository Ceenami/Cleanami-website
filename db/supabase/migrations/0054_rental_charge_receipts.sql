-- OWNER-OPERATED. Apply before deploying the rental-pricing repairs. No backfill.
-- Billing results must not modify the issued addons_snapshot protected by 0052/0053.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $$ BEGIN
  IF to_regclass('public.jobs') IS NULL THEN
    RAISE EXCEPTION '0054 requires the existing jobs baseline';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
    AND table_name='jobs' AND column_name='rental_charge' AND data_type<>'jsonb') THEN
    RAISE EXCEPTION '0054 refuses an incompatible existing rental_charge column';
  END IF;
END $$;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS rental_charge jsonb;
COMMENT ON COLUMN public.jobs.rental_charge IS 'rental-charge-v1:0054; immutable authorization receipt; no historical backfill';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.jobs'::regclass
    AND conname='jobs_rental_charge_shape') THEN
    ALTER TABLE public.jobs ADD CONSTRAINT jobs_rental_charge_shape CHECK (
      rental_charge IS NULL OR (jsonb_typeof(rental_charge)='object'
      AND (rental_charge->>'version') IS NOT DISTINCT FROM 'rental-charge-v1')
    );
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS rental_billing_private;
REVOKE ALL ON SCHEMA rental_billing_private FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION rental_billing_private.charge_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog,public AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.rental_charge IS NOT NULL THEN
      RAISE EXCEPTION 'Rental charge must be frozen after job creation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.rental_charge IS NOT DISTINCT FROM OLD.rental_charge THEN RETURN NEW; END IF;
  IF OLD.rental_charge IS NOT NULL THEN RAISE EXCEPTION 'Rental charge receipt is immutable'; END IF;
  IF current_user NOT IN ('postgres','service_role','supabase_admin')
    OR current_setting('role',true) IN ('anon','authenticated')
    OR current_setting('cleannami.rental_charge_freeze',true) IS DISTINCT FROM 'v1'
    OR OLD.service_type IS DISTINCT FROM 'vacation_rental_subscription'
    OR OLD.status NOT IN ('unassigned','assigned') OR OLD.status IS NULL
    OR OLD.payment_intent_id IS NOT NULL OR OLD.payment_status IS NOT NULL
  THEN RAISE EXCEPTION 'Rental charge requires an unpaid, unstarted job and the server billing workflow'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION rental_billing_private.charge_guard() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS rental_charge_guard ON public.jobs;
CREATE TRIGGER rental_charge_guard BEFORE INSERT OR UPDATE ON public.jobs
FOR EACH ROW EXECUTE FUNCTION rental_billing_private.charge_guard();
COMMIT;
