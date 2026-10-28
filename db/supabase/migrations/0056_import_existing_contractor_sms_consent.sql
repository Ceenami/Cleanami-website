-- Owner-operated follow-up to 0055. No dependency on Phase 2C migrations.
-- Owner confirmed on 2026-10-28 that all existing contractors have recorded
-- prior SMS consent. Import separately from new checkbox consent; created_at
-- records import time, NOT the original consent date. Keep the original records.
BEGIN;

ALTER TABLE public.cleaner_sms_consent_events
  ADD COLUMN IF NOT EXISTS evidence_reference text;
ALTER TABLE public.cleaner_sms_consent_events
  DROP CONSTRAINT IF EXISTS cleaner_sms_consent_events_event_type_check;
ALTER TABLE public.cleaner_sms_consent_events
  ADD CONSTRAINT cleaner_sms_consent_events_event_type_check CHECK (event_type IN
    ('consent_granted', 'consent_imported', 'consent_withdrawn', 'carrier_stop', 'carrier_start'));
ALTER TABLE public.cleaner_sms_consent_events
  DROP CONSTRAINT IF EXISTS cleaner_sms_consent_events_source_check;
ALTER TABLE public.cleaner_sms_consent_events
  ADD CONSTRAINT cleaner_sms_consent_events_source_check CHECK (source IN
    ('onboarding', 'profile', 'twilio', 'prior_consent_import'));
ALTER TABLE public.cleaner_sms_consent_events
  DROP CONSTRAINT IF EXISTS cleaner_sms_consent_source;
ALTER TABLE public.cleaner_sms_consent_events
  ADD CONSTRAINT cleaner_sms_consent_source CHECK (
    (source = 'twilio' AND event_type IN ('carrier_stop', 'carrier_start') AND provider_message_sid IS NOT NULL)
    OR (source IN ('onboarding', 'profile') AND event_type IN ('consent_granted', 'consent_withdrawn'))
    OR (source = 'prior_consent_import' AND event_type = 'consent_imported'
        AND nullif(btrim(evidence_reference), '') IS NOT NULL)
  );

-- Fixed cohort: accounts already present at the owner's confirmation. New
-- contractors must opt in themselves. Retain the original consent records
-- referenced by the owner's confirmation; do not claim a new checkbox action.
WITH existing AS (
  SELECT id, btrim(phone_number) AS raw_phone,
    regexp_replace(phone_number, '[^0-9]', '', 'g') AS digits
  FROM public.cleaners
  WHERE created_at <= '2026-10-28T13:57:59Z'::timestamptz
), normalized AS (
  SELECT id, CASE
    WHEN raw_phone !~ '^\+?[0-9[:space:]().-]+$' THEN NULL
    WHEN left(raw_phone, 1) = '+' AND digits ~ '^[1-9][0-9]{7,14}$' THEN '+' || digits
    WHEN left(raw_phone, 1) <> '+' AND digits ~ '^[2-9][0-9]{9}$' THEN '+1' || digits
    WHEN left(raw_phone, 1) <> '+' AND digits ~ '^1[2-9][0-9]{9}$' THEN '+' || digits
    ELSE NULL END AS phone
  FROM existing
)
INSERT INTO public.cleaner_sms_consent_events
  (cleaner_id, phone, event_type, source, evidence_reference)
SELECT n.id, n.phone, 'consent_imported', 'prior_consent_import',
  'Owner confirmation on 2026-10-28: prior operational SMS consent is recorded for all existing contractors; original dates and methods are retained in the owner-held records.'
FROM normalized n
WHERE n.phone IS NOT NULL
  -- Never overwrite consent choices, or resurrect withdrawn consent on reruns.
  AND NOT EXISTS (
    SELECT 1 FROM public.cleaner_sms_consent_events e WHERE e.cleaner_id = n.id
      AND e.event_type IN ('consent_granted', 'consent_imported', 'consent_withdrawn')
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.cleaner_sms_consent_events e
    WHERE e.phone = n.phone AND e.event_type = 'consent_withdrawn'
  )
  AND coalesce((
    SELECT e.event_type FROM public.cleaner_sms_consent_events e
    WHERE e.phone = n.phone AND e.event_type IN ('carrier_stop', 'carrier_start')
    ORDER BY e.id DESC LIMIT 1
  ), '') <> 'carrier_stop';

COMMIT;
