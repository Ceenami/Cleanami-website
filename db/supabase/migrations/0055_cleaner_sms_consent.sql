-- Owner-operated migration. Review and apply before deploying consent code.
-- No legacy opt-in backfill: providing a phone number is not SMS consent.
BEGIN;

CREATE TABLE IF NOT EXISTS public.cleaner_sms_consent_events (
  id bigserial PRIMARY KEY,
  cleaner_id uuid REFERENCES public.cleaners(id) ON DELETE SET NULL,
  phone text NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  event_type text NOT NULL CHECK (event_type IN
    ('consent_granted', 'consent_withdrawn', 'carrier_stop', 'carrier_start')),
  source text NOT NULL CHECK (source IN ('onboarding', 'profile', 'twilio')),
  disclosure_version text,
  disclosure_text text,
  terms_url text,
  privacy_url text,
  provider_message_sid text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cleaner_sms_consent_evidence CHECK (
    event_type <> 'consent_granted' OR
    (disclosure_version IS NOT NULL AND
     disclosure_text IS NOT NULL AND terms_url IS NOT NULL AND privacy_url IS NOT NULL)
  ),
  CONSTRAINT cleaner_sms_consent_source CHECK (
    (source = 'twilio' AND event_type IN ('carrier_stop', 'carrier_start') AND provider_message_sid IS NOT NULL)
    OR (source IN ('onboarding', 'profile') AND event_type IN ('consent_granted', 'consent_withdrawn'))
  )
);

CREATE INDEX IF NOT EXISTS cleaner_sms_consent_cleaner_idx
  ON public.cleaner_sms_consent_events (cleaner_id, id);
CREATE INDEX IF NOT EXISTS cleaner_sms_consent_phone_idx
  ON public.cleaner_sms_consent_events (phone, id);
CREATE UNIQUE INDEX IF NOT EXISTS cleaner_sms_consent_provider_sid_idx
  ON public.cleaner_sms_consent_events (provider_message_sid);

ALTER TABLE public.cleaner_sms_consent_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cleaner_sms_consent_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.cleaner_sms_consent_events_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.cleaner_sms_consent_events FROM service_role;
REVOKE ALL ON SEQUENCE public.cleaner_sms_consent_events_id_seq FROM service_role;
-- The authenticated website server uses the existing privileged DB connection.
-- No browser/Data API policies or grants: consent can only be recorded by the API.
GRANT SELECT, INSERT ON public.cleaner_sms_consent_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.cleaner_sms_consent_events_id_seq TO service_role;

COMMIT;
