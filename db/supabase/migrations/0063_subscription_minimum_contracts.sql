-- Owner review/apply only. No production execution, enrollment or historical backfill.
BEGIN;
CREATE TABLE IF NOT EXISTS public.subscription_minimums (
  subscription_id uuid PRIMARY KEY REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  policy text NOT NULL CHECK (policy = 'thirty_calendar_days_v1'),
  start_date date NOT NULL,
  ends_at timestamptz NOT NULL,
  payment_intent_id text NOT NULL UNIQUE CHECK (length(payment_intent_id) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at = ((start_date + 30)::timestamp AT TIME ZONE 'America/New_York'))
);
ALTER TABLE public.subscription_minimums ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.subscription_minimums FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_subscription_minimum_contract()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE issued public.subscriptions%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'subscription_minimum_is_immutable'; END IF;
  SELECT * INTO issued FROM public.subscriptions WHERE id = NEW.subscription_id FOR SHARE;
  IF NOT FOUND OR issued.start_date IS DISTINCT FROM NEW.start_date
    OR issued.first_clean_payment_id IS DISTINCT FROM NEW.payment_intent_id THEN
    RAISE EXCEPTION 'subscription_minimum_provenance_mismatch';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_subscription_minimum_contract() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_subscription_minimum_contract ON public.subscription_minimums;
CREATE TRIGGER guard_subscription_minimum_contract BEFORE INSERT OR UPDATE ON public.subscription_minimums
FOR EACH ROW EXECUTE FUNCTION public.guard_subscription_minimum_contract();
COMMIT;
