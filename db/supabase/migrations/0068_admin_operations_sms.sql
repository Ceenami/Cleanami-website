-- New SMS intents only. No backfill, provider send or production activation.
-- Owner-reviewed apply after SQL0061 (delivery observations) and prerequisites.
BEGIN;
CREATE TABLE IF NOT EXISTS public.admin_sms_intents (
 identity text PRIMARY KEY, recipient text NOT NULL CHECK(recipient ~ '^\+[1-9][0-9]{7,14}$'),
 sender_key text NOT NULL, category text NOT NULL CHECK(category IN('admin_notice','assignment','swap_requested','dispute_update','booking_alert','subscription_purchase','one_off_booking','turnover_created','gps_overdue')), environment text NOT NULL CHECK(environment IN('test','production')), job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
 destination text NOT NULL CHECK(destination ~ '^/admin(/|$)' AND destination !~ '[?#\\]'),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','claimed','sent','failed','unknown','skipped')),
 provider_sid text UNIQUE, last_error text, created_at timestamptz NOT NULL DEFAULT now(), claimed_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.admin_sms_preferences (
 recipient text NOT NULL CHECK(recipient ~ '^\+[1-9][0-9]{7,14}$'), sender_key text NOT NULL,
 carrier_blocked boolean NOT NULL DEFAULT false, last_stop_sid text, last_stop_at timestamptz,
 last_start_at timestamptz, opted_in_at timestamptz, PRIMARY KEY(recipient,sender_key)
);
CREATE TABLE IF NOT EXISTS public.admin_sms_carrier_events (
 message_sid text PRIMARY KEY CHECK(message_sid ~ '^SM[0-9a-fA-F]{32}$'),
 recipient text NOT NULL, sender_key text NOT NULL, blocked boolean NOT NULL,
 provider_created_at timestamptz, received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_sms_pending ON public.admin_sms_intents(state,created_at);
CREATE INDEX IF NOT EXISTS admin_sms_job ON public.admin_sms_intents(job_id);
CREATE INDEX IF NOT EXISTS admin_sms_carrier_phone ON public.admin_sms_carrier_events(recipient,sender_key);
CREATE OR REPLACE FUNCTION public.protect_admin_sms_history() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Admin SMS history must be retained'; END IF;
 IF TG_TABLE_NAME='admin_sms_carrier_events' THEN RAISE EXCEPTION 'Carrier history is append only'; END IF;
 IF NEW.identity IS DISTINCT FROM OLD.identity OR NEW.recipient IS DISTINCT FROM OLD.recipient OR NEW.sender_key IS DISTINCT FROM OLD.sender_key
   OR NEW.category IS DISTINCT FROM OLD.category OR NEW.environment IS DISTINCT FROM OLD.environment OR NEW.destination IS DISTINCT FROM OLD.destination OR NEW.created_at IS DISTINCT FROM OLD.created_at
   OR (NEW.job_id IS DISTINCT FROM OLD.job_id AND NEW.job_id IS NOT NULL)
   OR (OLD.provider_sid IS NOT NULL AND NEW.provider_sid IS DISTINCT FROM OLD.provider_sid)
   OR (OLD.state<>'pending' AND NEW.state='pending') OR (OLD.state='sent' AND NEW.state IS DISTINCT FROM OLD.state)
   THEN RAISE EXCEPTION 'Admin SMS intent is immutable; never reset an uncertain send'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_admin_sms_intent ON public.admin_sms_intents;
CREATE TRIGGER protect_admin_sms_intent BEFORE UPDATE OR DELETE ON public.admin_sms_intents FOR EACH ROW EXECUTE FUNCTION public.protect_admin_sms_history();
DROP TRIGGER IF EXISTS protect_admin_sms_carrier ON public.admin_sms_carrier_events;
CREATE TRIGGER protect_admin_sms_carrier BEFORE UPDATE OR DELETE ON public.admin_sms_carrier_events FOR EACH ROW EXECUTE FUNCTION public.protect_admin_sms_history();
ALTER TABLE public.admin_sms_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_sms_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_sms_carrier_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_sms_intents,public.admin_sms_preferences,public.admin_sms_carrier_events FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.protect_admin_sms_history() FROM PUBLIC,anon,authenticated;
COMMIT;
