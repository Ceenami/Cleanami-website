-- Owner-operated, additive. Requires 0049/0050. Never apply to production here.
-- No backfill or rewrite of old prices, rates, assignments, evidence or payouts.
BEGIN;
-- Do not install versioned pay without the inherited coverage/team/schedule
-- guards. A successfully installed function alone does not prove they exist.
DO $$
BEGIN
 IF to_regclass('public.phase2c_availability_days') IS NULL
  OR to_regclass('public.phase2c_property_exclusions') IS NULL
  OR to_regclass('public.phase2c_property_policy') IS NULL
  OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
   AND table_name='jobs_to_cleaners' AND column_name='frozen_hourly_rate_cents' AND data_type='integer')
  OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.jobs_to_cleaners'::regclass
   AND tgname='phase2c_assignment_guard' AND tgenabled IN ('O','A'))
  OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.jobs_to_cleaners'::regclass
   AND tgname='phase2c_working_team_guard' AND tgdeferrable AND tgenabled IN ('O','A'))
  OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.jobs'::regclass
   AND tgname='phase2c_job_team_guard' AND tgdeferrable AND tgenabled IN ('O','A'))
  OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.jobs'::regclass
   AND tgname='phase2c_schedule_edit_guard' AND tgenabled IN ('O','A'))
 THEN RAISE EXCEPTION 'residential_v2_requires_sql0049_sql0050'; END IF;
END $$;
ALTER TABLE public.jobs_to_cleaners ADD COLUMN IF NOT EXISTS residential_pay_terms jsonb;
ALTER TABLE public.payouts ADD COLUMN IF NOT EXISTS pay_receipt jsonb;
CREATE TABLE IF NOT EXISTS public.phase2c_residential_checkout_attempts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),slot_key text NOT NULL,generation integer NOT NULL CHECK(generation>0),
 request_identity text NOT NULL,terms jsonb NOT NULL,amount_charged_cents integer NOT NULL CHECK(amount_charged_cents>=0),
 payment_intent_id text,job_id uuid REFERENCES public.jobs(id),created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT residential_checkout_slot_generation UNIQUE(slot_key,generation),
 CONSTRAINT residential_checkout_payment_intent UNIQUE(payment_intent_id)
);
CREATE INDEX IF NOT EXISTS residential_checkout_job_idx ON public.phase2c_residential_checkout_attempts(job_id);
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS residential_checkout_attempt_id uuid REFERENCES public.phase2c_residential_checkout_attempts(id);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_residential_checkout_attempt_idx ON public.jobs(residential_checkout_attempt_id);
CREATE OR REPLACE FUNCTION public.residential_v2_guard_job_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.residential_checkout_attempt_id IS DISTINCT FROM OLD.residential_checkout_attempt_id THEN
  RAISE EXCEPTION 'checkout_job_identity_is_immutable';
 END IF;
 IF OLD.addons_snapshot->'residentialPricing'->>'ruleVersion'='residential-v2' AND (
  NEW.id IS DISTINCT FROM OLD.id OR NEW.property_id IS DISTINCT FROM OLD.property_id OR NEW.subscription_id IS DISTINCT FROM OLD.subscription_id
  OR NEW.calendar_event_uid IS DISTINCT FROM OLD.calendar_event_uid OR NEW.job_source IS DISTINCT FROM OLD.job_source
  OR NEW.payment_intent_id IS DISTINCT FROM OLD.payment_intent_id
 ) THEN RAISE EXCEPTION 'v2_booking_identity_is_immutable'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS residential_v2_job_identity ON public.jobs;
CREATE TRIGGER residential_v2_job_identity BEFORE UPDATE ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.residential_v2_guard_job_identity();
REVOKE ALL ON FUNCTION public.residential_v2_guard_job_identity() FROM PUBLIC,anon,authenticated;
ALTER TABLE public.phase2c_residential_checkout_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.phase2c_residential_checkout_attempts FROM PUBLIC,anon,authenticated;
-- Server DB connection owns this table; no public read/write policy or RPC.
CREATE OR REPLACE FUNCTION public.residential_v2_guard_checkout() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.slot_key IS DISTINCT FROM OLD.slot_key OR NEW.generation IS DISTINCT FROM OLD.generation
  OR NEW.request_identity IS DISTINCT FROM OLD.request_identity OR NEW.terms IS DISTINCT FROM OLD.terms
  OR NEW.amount_charged_cents IS DISTINCT FROM OLD.amount_charged_cents OR NEW.created_at IS DISTINCT FROM OLD.created_at
  OR (OLD.payment_intent_id IS NOT NULL AND NEW.payment_intent_id IS DISTINCT FROM OLD.payment_intent_id)
  OR (OLD.job_id IS NOT NULL AND NEW.job_id IS DISTINCT FROM OLD.job_id)
 THEN RAISE EXCEPTION 'checkout_terms_are_immutable'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS residential_v2_checkout_terms ON public.phase2c_residential_checkout_attempts;
CREATE TRIGGER residential_v2_checkout_terms BEFORE UPDATE ON public.phase2c_residential_checkout_attempts
FOR EACH ROW EXECUTE FUNCTION public.residential_v2_guard_checkout();
REVOKE ALL ON FUNCTION public.residential_v2_guard_checkout() FROM PUBLIC,anon,authenticated;

-- 0050 remains responsible for coverage, exclusions, row/advisory locks,
-- residential/pet qualifications, team completeness and physical overlap.
CREATE OR REPLACE FUNCTION public.residential_v2_guard_assignment() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE j public.jobs%ROWTYPE; v text;
BEGIN
 SELECT * INTO j FROM public.jobs WHERE id=NEW.job_id FOR UPDATE;
 v=j.addons_snapshot->'residentialPricing'->>'ruleVersion';
 IF j.addons_snapshot ? 'residentialPricing' AND v IS NULL THEN RAISE EXCEPTION 'corrupt_residential_version'; END IF;
 IF v IS NULL OR v='residential-v1' THEN
  IF NEW.residential_pay_terms IS NOT NULL THEN RAISE EXCEPTION 'unexpected_v2_assignment_terms'; END IF;
  RETURN NEW;
 END IF;
 IF v<>'residential-v2' THEN RAISE EXCEPTION 'unsupported_residential_pay_version'; END IF;
 IF j.service_type<>'residential_one_time' THEN RAISE EXCEPTION 'v2_is_residential_only'; END IF;
 IF j.addons_snapshot->'residentialPricing'->>'configHash' IS DISTINCT FROM 'ca69b5d701631a46069ba99da526fc3bf979ef11f9b453c428efe67a2f73f5da' THEN RAISE EXCEPTION 'unsupported_v2_config'; END IF;
 IF NEW.role::text NOT IN ('primary','laundry_lead') THEN NEW.residential_pay_terms=NULL; RETURN NEW; END IF;
 -- This label is deliberately NOT emitted until an execution policy is accepted.
 IF j.addons_snapshot->'residentialPricing'->>'payRatePolicy' IS DISTINCT FROM 'flat_1900_min_5500' THEN RAISE EXCEPTION 'v2_execution_policy_pending'; END IF;
 IF COALESCE(NEW.urgent_bonus,false) THEN RAISE EXCEPTION 'v2_urgent_policy_pending'; END IF;
 NEW.frozen_hourly_rate_cents=1900;
 IF COALESCE(current_setting('cleannami.v2_terms_writer',true),'')<>'guard' THEN
  IF TG_OP='UPDATE' AND NEW.job_id=OLD.job_id AND NEW.cleaner_id=OLD.cleaner_id AND NEW.role=OLD.role THEN
   NEW.residential_pay_terms=OLD.residential_pay_terms;
  ELSE NEW.residential_pay_terms=NULL;
  END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS zz_residential_v2_assignment ON public.jobs_to_cleaners;
CREATE TRIGGER zz_residential_v2_assignment BEFORE INSERT OR UPDATE ON public.jobs_to_cleaners
FOR EACH ROW EXECUTE FUNCTION public.residential_v2_guard_assignment();

-- One database-owned allocation path covers automatic/manual/swap/backup/urgent
-- writers. Retain a qualified named task owner; otherwise transfer the complete
-- commitment to a qualified working replacement. Reliability team leader is separate.
CREATE OR REPLACE FUNCTION public.residential_v2_allocate_team() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE jid uuid; j public.jobs%ROWTYPE; p jsonb; lead uuid; has_extra boolean;
 hot text; loads integer; lead_hours numeric; base_hours numeric; prior text;
BEGIN
 IF TG_TABLE_NAME='jobs' THEN jid=NEW.id; ELSE jid=COALESCE(NEW.job_id,OLD.job_id); END IF;
 SELECT * INTO j FROM public.jobs WHERE id=jid FOR UPDATE;
 IF j.id IS NULL OR j.addons_snapshot->'residentialPricing'->>'ruleVersion' IS DISTINCT FROM 'residential-v2' THEN RETURN NULL; END IF;
 IF j.status::text NOT IN ('assigned','unassigned') THEN RETURN NULL; END IF;
 p=j.addons_snapshot->'residentialPricing'; hot=p->'input'->>'hotTub';
 loads=(p->'input'->>'inUnitLaundryLoads')::integer;
 lead_hours=(p->'leadTaskPlan'->>'paidHours')::numeric;
 base_hours=(p->>'expectedHoursPerCleaner')::numeric;
 IF hot IS NULL OR hot NOT IN ('none','basic','full') OR loads IS NULL OR loads<0 OR loads>2
  OR base_hours IS NULL OR base_hours<=0 OR lead_hours IS NULL OR lead_hours<0
  OR base_hours<>j.expected_hours THEN RAISE EXCEPTION 'invalid_v2_job_plan'; END IF;
 IF lead_hours <> ceil(((CASE hot WHEN 'basic' THEN 0.5 WHEN 'full' THEN 1.5 ELSE 0 END)+loads*0.5)/0.25)*0.25
  OR base_hours<>ceil(base_hours/0.25)*0.25 THEN RAISE EXCEPTION 'invalid_v2_job_hours'; END IF;
 has_extra=lead_hours>0;
 IF has_extra THEN
  SELECT x.cleaner_id INTO lead FROM public.jobs_to_cleaners x JOIN public.cleaners c ON c.id=x.cleaner_id
  WHERE x.job_id=jid AND x.role::text IN ('primary','laundry_lead') AND (hot='none' OR c.has_hot_tub_cert)
  ORDER BY COALESCE((x.residential_pay_terms->>'addonLead')::boolean,false) DESC,x.cleaner_id LIMIT 1;
  IF lead IS NULL AND j.status::text='assigned' THEN RAISE EXCEPTION 'v2_missing_qualified_named_lead'; END IF;
 END IF;
 prior=COALESCE(current_setting('cleannami.v2_terms_writer',true),'');
 PERFORM set_config('cleannami.v2_terms_writer','guard',true);
 UPDATE public.jobs_to_cleaners x SET residential_pay_terms=CASE WHEN x.role::text IN ('primary','laundry_lead') THEN
  jsonb_build_object('version','residential-v2','configHash',p->>'configHash','policyRevision',p->>'payRatePolicy',
   'hourlyRateCents',1900,'minimumBaseCents',5500,'baseHours',base_hours,
   'leadHours',CASE WHEN x.cleaner_id=lead THEN lead_hours ELSE 0 END,
   'addonLead',COALESCE(x.cleaner_id=lead,false),'hotTub',hot,'inUnitLaundryLoads',loads) ELSE NULL END
 WHERE x.job_id=jid AND x.residential_pay_terms IS DISTINCT FROM CASE WHEN x.role::text IN ('primary','laundry_lead') THEN
  jsonb_build_object('version','residential-v2','configHash',p->>'configHash','policyRevision',p->>'payRatePolicy',
   'hourlyRateCents',1900,'minimumBaseCents',5500,'baseHours',base_hours,
   'leadHours',CASE WHEN x.cleaner_id=lead THEN lead_hours ELSE 0 END,
   'addonLead',COALESCE(x.cleaner_id=lead,false),'hotTub',hot,'inUnitLaundryLoads',loads) ELSE NULL END;
 PERFORM set_config('cleannami.v2_terms_writer',prior,true);
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS residential_v2_team_terms ON public.jobs_to_cleaners;
CREATE CONSTRAINT TRIGGER residential_v2_team_terms AFTER INSERT OR UPDATE OR DELETE ON public.jobs_to_cleaners
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.residential_v2_allocate_team();
DROP TRIGGER IF EXISTS residential_v2_job_terms ON public.jobs;
CREATE CONSTRAINT TRIGGER residential_v2_job_terms AFTER INSERT OR UPDATE ON public.jobs
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.residential_v2_allocate_team();

-- Financial components survive cancellation removing the assignment. Transfer
-- claim/status/provider fields stay mutable; accepted money and receipts do not.
CREATE OR REPLACE FUNCTION public.residential_v2_guard_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE p jsonb; t jsonb; r jsonb; assignment_role text; hourly_cents numeric; base_cents numeric; lead_cents numeric;
BEGIN
 IF TG_OP='UPDATE' AND OLD.pay_receipt IS NOT NULL THEN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.pay_receipt IS DISTINCT FROM OLD.pay_receipt OR NEW.amount IS DISTINCT FROM OLD.amount
   OR NEW.job_id IS DISTINCT FROM OLD.job_id OR NEW.cleaner_id IS DISTINCT FROM OLD.cleaner_id
   OR NEW.urgent_bonus_amount IS DISTINCT FROM OLD.urgent_bonus_amount
   OR NEW.laundry_bonus_amount IS DISTINCT FROM OLD.laundry_bonus_amount
   OR NEW.late_deduction_amount IS DISTINCT FROM OLD.late_deduction_amount THEN RAISE EXCEPTION 'v2_payout_receipt_is_immutable'; END IF;
  RETURN NEW;
 END IF;
 SELECT addons_snapshot->'residentialPricing' INTO p FROM public.jobs WHERE id=NEW.job_id;
 IF p IS NULL OR p->>'ruleVersion'='residential-v1' THEN
  IF NEW.pay_receipt IS NOT NULL THEN RAISE EXCEPTION 'unexpected_v2_payout_receipt'; END IF;
  RETURN NEW;
 END IF;
 IF p->>'ruleVersion'<>'residential-v2' THEN RAISE EXCEPTION 'unsupported_residential_pay_version'; END IF;
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'v2_receipt_required_at_payout_creation'; END IF;
 SELECT residential_pay_terms,role::text INTO t,assignment_role FROM public.jobs_to_cleaners
 WHERE job_id=NEW.job_id AND cleaner_id=NEW.cleaner_id AND role::text IN ('primary','laundry_lead');
 r=NEW.pay_receipt;
 IF t IS NULL OR r IS NULL OR NOT (r ?& ARRAY['version','configHash','policyRevision','role','baseHours','hourlyRateCents',
  'minimumBaseCents','hourlyBaseCents','minimumTopUpCents','basePayCents','leadHours','leadPayCents',
  'urgentBonusCents','lateDeductionCents','totalCents','settlement']) THEN RAISE EXCEPTION 'v2_pay_receipt_required'; END IF;
 hourly_cents=round((t->>'baseHours')::numeric*(t->>'hourlyRateCents')::numeric);
 base_cents=greatest((t->>'minimumBaseCents')::numeric,hourly_cents);
 lead_cents=round((t->>'leadHours')::numeric*(t->>'hourlyRateCents')::numeric);
 IF r->>'version' IS DISTINCT FROM 'residential-v2' OR r->>'configHash' IS DISTINCT FROM t->>'configHash'
  OR r->>'policyRevision' IS DISTINCT FROM t->>'policyRevision'
  OR r->>'role' IS DISTINCT FROM assignment_role
  OR r->>'settlement' IS DISTINCT FROM 'completed'
  OR (r->>'baseHours')::numeric IS DISTINCT FROM (t->>'baseHours')::numeric
  OR (r->>'hourlyRateCents')::numeric IS DISTINCT FROM (t->>'hourlyRateCents')::numeric
  OR (r->>'minimumBaseCents')::numeric IS DISTINCT FROM (t->>'minimumBaseCents')::numeric
  OR (r->>'hourlyBaseCents')::numeric IS DISTINCT FROM hourly_cents
  OR (r->>'minimumTopUpCents')::numeric IS DISTINCT FROM base_cents-hourly_cents
  OR (r->>'basePayCents')::numeric IS DISTINCT FROM base_cents
  OR (r->>'leadHours')::numeric IS DISTINCT FROM (t->>'leadHours')::numeric
  OR (r->>'leadPayCents')::numeric IS DISTINCT FROM lead_cents
  OR (r->>'urgentBonusCents')::numeric IS DISTINCT FROM 0::numeric
  OR (r->>'lateDeductionCents')::numeric IS DISTINCT FROM 0::numeric
  OR (r->>'totalCents')::numeric IS DISTINCT FROM base_cents+lead_cents
  OR NEW.amount*100 IS DISTINCT FROM base_cents+lead_cents
  OR COALESCE(NEW.urgent_bonus_amount,0)<>0 OR COALESCE(NEW.laundry_bonus_amount,0)<>0
  OR COALESCE(NEW.late_deduction_amount,0)<>0 THEN RAISE EXCEPTION 'invalid_v2_payout_components'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS residential_v2_payout_receipt ON public.payouts;
CREATE TRIGGER residential_v2_payout_receipt BEFORE INSERT OR UPDATE ON public.payouts
FOR EACH ROW EXECUTE FUNCTION public.residential_v2_guard_receipt();

-- Trigger-only functions are not callable application RPCs. Existing table RLS
-- and grants stay intact; no new public data surface is introduced.
REVOKE ALL ON FUNCTION public.residential_v2_guard_assignment() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.residential_v2_allocate_team() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.residential_v2_guard_receipt() FROM PUBLIC,anon,authenticated;
COMMIT;
