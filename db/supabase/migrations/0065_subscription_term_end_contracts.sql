-- Owner apply only. Prospective signup policy; no existing subscription/job backfill.
BEGIN;
CREATE TABLE IF NOT EXISTS public.subscription_term_contracts (
 subscription_id uuid PRIMARY KEY REFERENCES public.subscriptions(id),
 policy text NOT NULL CHECK(policy='stop_at_selected_end_v1'),
 start_date date NOT NULL, end_date date NOT NULL CHECK(end_date>=start_date),
 payment_intent_id text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.subscription_term_contracts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.subscription_term_contracts FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS subscription_term_end_idx ON public.subscription_term_contracts(end_date);
CREATE OR REPLACE FUNCTION public.guard_subscription_term_contract() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE issued public.subscriptions%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'subscription_term_is_immutable'; END IF;
 SELECT * INTO issued FROM public.subscriptions WHERE id=NEW.subscription_id FOR SHARE;
 IF NOT FOUND OR issued.start_date IS DISTINCT FROM NEW.start_date OR issued.end_date IS DISTINCT FROM NEW.end_date
   OR issued.first_clean_payment_id IS DISTINCT FROM NEW.payment_intent_id THEN RAISE EXCEPTION 'subscription_term_provenance_mismatch'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_subscription_term_contract() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_subscription_term_contract ON public.subscription_term_contracts;
CREATE TRIGGER guard_subscription_term_contract BEFORE INSERT OR UPDATE ON public.subscription_term_contracts FOR EACH ROW EXECUTE FUNCTION public.guard_subscription_term_contract();
CREATE OR REPLACE FUNCTION public.guard_recorded_subscription_job_term() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public SET timezone='UTC' AS $$
DECLARE term public.subscription_term_contracts%ROWTYPE; current_status text; service_day date;
BEGIN
 IF NEW.subscription_id IS NULL THEN RETURN NEW; END IF;
 -- Existing execution/schedule writers lock job first; follow the same parent order.
 SELECT status INTO current_status FROM public.subscriptions WHERE id=NEW.subscription_id FOR SHARE;
 SELECT * INTO term FROM public.subscription_term_contracts WHERE subscription_id=NEW.subscription_id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.check_in_time IS NOT DISTINCT FROM OLD.check_in_time AND NEW.subscription_id IS NOT DISTINCT FROM OLD.subscription_id THEN RETURN NEW; END IF;
 service_day=(NEW.check_in_time::timestamptz AT TIME ZONE 'America/New_York')::date;
 IF current_status<>'active' OR service_day IS NULL OR service_day<term.start_date OR service_day>term.end_date
   THEN RAISE EXCEPTION 'outside_recorded_subscription_term'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_recorded_subscription_job_term() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_recorded_subscription_job_term ON public.jobs;
CREATE TRIGGER guard_recorded_subscription_job_term BEFORE INSERT OR UPDATE OF subscription_id,check_in_time ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.guard_recorded_subscription_job_term();
CREATE OR REPLACE FUNCTION public.protect_recorded_subscription_dates() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.subscription_term_contracts WHERE subscription_id=OLD.id)
  AND (NEW.start_date IS DISTINCT FROM OLD.start_date OR NEW.end_date IS DISTINCT FROM OLD.end_date OR NEW.first_clean_payment_id IS DISTINCT FROM OLD.first_clean_payment_id)
 THEN RAISE EXCEPTION 'recorded_subscription_dates_are_immutable'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.protect_recorded_subscription_dates() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS protect_recorded_subscription_dates ON public.subscriptions;
CREATE TRIGGER protect_recorded_subscription_dates BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.protect_recorded_subscription_dates();
COMMIT;
