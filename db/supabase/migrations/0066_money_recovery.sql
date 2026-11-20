-- New records only. Do not backfill historical payments, transfers or events.
-- Stop old payout workers before applying; set PAYOUT_TRANSFER_ROLLOUT_AT to
-- the UTC cutover AFTER the last old worker exits. Earlier pending payouts
-- require provider reconciliation before any new dispatch.
BEGIN;
CREATE TABLE IF NOT EXISTS public.rental_checkout_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_key text NOT NULL,
  generation integer NOT NULL CHECK (generation > 0),
  request_identity text NOT NULL,
  terms jsonb NOT NULL CHECK (terms->>'version' = '1'),
  provider_params jsonb NOT NULL CHECK ((provider_params->>'amount')::integer >= 50 AND provider_params->>'currency' = 'usd'),
  payment_intent_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS rental_checkout_slot_generation ON public.rental_checkout_attempts(slot_key,generation);
CREATE UNIQUE INDEX IF NOT EXISTS rental_checkout_payment_intent ON public.rental_checkout_attempts(payment_intent_id);
CREATE TABLE IF NOT EXISTS public.payout_transfer_attempts (
  payout_id uuid PRIMARY KEY REFERENCES public.payouts(id) ON DELETE RESTRICT,
  provider_params jsonb NOT NULL CHECK ((provider_params->>'amount')::integer >= 100 AND provider_params->>'currency' = 'usd'),
  state text NOT NULL DEFAULT 'prepared' CHECK (state IN ('prepared','unknown','succeeded','review')),
  transfer_id text UNIQUE,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (state <> 'succeeded' OR transfer_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS public.stripe_webhook_claims (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  payload_hash text NOT NULL,
  state text NOT NULL CHECK (state IN ('processing','failed','completed')),
  token uuid NOT NULL,
  claimed_at timestamptz NOT NULL,
  completed_at timestamptz,
  CHECK ((state = 'completed') = (completed_at IS NOT NULL))
);
CREATE OR REPLACE FUNCTION public.protect_money_attempt() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_TABLE_NAME = 'rental_checkout_attempts' THEN
    IF (to_jsonb(NEW) - 'payment_intent_id') IS DISTINCT FROM (to_jsonb(OLD) - 'payment_intent_id')
       OR (OLD.payment_intent_id IS NOT NULL AND NEW.payment_intent_id IS DISTINCT FROM OLD.payment_intent_id) THEN
      RAISE EXCEPTION 'Rental checkout terms and provider binding are immutable';
    END IF;
  ELSE
    IF NEW.payout_id IS DISTINCT FROM OLD.payout_id OR NEW.provider_params IS DISTINCT FROM OLD.provider_params
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR (OLD.transfer_id IS NOT NULL AND NEW.transfer_id IS DISTINCT FROM OLD.transfer_id) THEN
      RAISE EXCEPTION 'Payout attempt terms and provider binding are immutable';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_rental_checkout ON public.rental_checkout_attempts;
CREATE TRIGGER protect_rental_checkout BEFORE UPDATE ON public.rental_checkout_attempts FOR EACH ROW EXECUTE FUNCTION public.protect_money_attempt();
DROP TRIGGER IF EXISTS protect_payout_transfer ON public.payout_transfer_attempts;
CREATE TRIGGER protect_payout_transfer BEFORE UPDATE ON public.payout_transfer_attempts FOR EACH ROW EXECUTE FUNCTION public.protect_money_attempt();
REVOKE ALL ON FUNCTION public.protect_money_attempt() FROM PUBLIC, anon, authenticated;
ALTER TABLE public.rental_checkout_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_transfer_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_webhook_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rental_checkout_attempts, public.payout_transfer_attempts, public.stripe_webhook_claims FROM PUBLIC, anon, authenticated;
COMMIT;
