-- Prospective execution policy, without changing booked rates or historical receipts.
-- Owner-operated in production. Install after 0051; safe to reapply.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='residential_v2_payout_receipt' AND NOT tgisinternal AND tgenabled<>'D') THEN
  RAISE EXCEPTION '0051 residential payout receipt guard must be installed and enabled';
 END IF;
END $$;

-- Preserve all assignment/rate protections; permit the accepted prospective urgent bonus.
CREATE OR REPLACE FUNCTION public.residential_v2_guard_assignment() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE j public.jobs%ROWTYPE; v text; execution text;
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
 IF j.addons_snapshot->'residentialPricing'->>'payRatePolicy' IS DISTINCT FROM 'flat_1900_min_5500' THEN RAISE EXCEPTION 'v2_execution_policy_pending'; END IF;
 execution=j.addons_snapshot->'residentialPricing'->>'executionPolicy';
 IF execution IS NOT NULL AND execution<>'residential-v2-execution-2026-11-02' THEN RAISE EXCEPTION 'unsupported_v2_execution_policy'; END IF;
 IF COALESCE(NEW.urgent_bonus,false) AND execution IS DISTINCT FROM 'residential-v2-execution-2026-11-02' THEN RAISE EXCEPTION 'v2_urgent_policy_pending'; END IF;
 NEW.frozen_hourly_rate_cents=1900;
 IF COALESCE(current_setting('cleannami.v2_terms_writer',true),'')<>'guard' THEN
  IF TG_OP='UPDATE' AND NEW.job_id=OLD.job_id AND NEW.cleaner_id=OLD.cleaner_id AND NEW.role=OLD.role THEN
   NEW.residential_pay_terms=OLD.residential_pay_terms;
  ELSE NEW.residential_pay_terms=NULL;
  END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.residential_v2_guard_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE p jsonb; t jsonb; r jsonb; assignment_role text; urgent boolean;
 hourly_cents numeric; base_cents numeric; lead_cents numeric; lead_hours numeric;
 bonus_cents numeric:=0; deduction_cents numeric:=0; total_cents numeric;
 delay numeric:=0; outcome text; prospective boolean;
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
 SELECT residential_pay_terms,role::text,COALESCE(urgent_bonus,false) INTO t,assignment_role,urgent
 FROM public.jobs_to_cleaners WHERE job_id=NEW.job_id AND cleaner_id=NEW.cleaner_id AND role::text IN ('primary','laundry_lead');
 r=NEW.pay_receipt;
 IF t IS NULL OR r IS NULL OR NOT (r ?& ARRAY['version','configHash','policyRevision','role','baseHours','hourlyRateCents',
  'minimumBaseCents','hourlyBaseCents','minimumTopUpCents','basePayCents','leadHours','leadPayCents',
  'urgentBonusCents','lateDeductionCents','totalCents','settlement']) THEN RAISE EXCEPTION 'v2_pay_receipt_required'; END IF;
 hourly_cents=round((t->>'baseHours')::numeric*(t->>'hourlyRateCents')::numeric);
 base_cents=greatest((t->>'minimumBaseCents')::numeric,hourly_cents);
 lead_hours=(t->>'leadHours')::numeric;
 outcome=r->>'settlement';
 prospective=p->>'executionPolicy' IS NOT NULL;
 IF prospective THEN
  IF p->>'executionPolicy' IS DISTINCT FROM 'residential-v2-execution-2026-11-02'
   OR r->>'executionPolicy' IS DISTINCT FROM p->>'executionPolicy'
   OR jsonb_typeof(r->'arrivalDelayMinutes') IS DISTINCT FROM 'number'
   OR jsonb_typeof(r->'urgentBonusEligible') IS DISTINCT FROM 'boolean'
   OR (r->>'urgentBonusEligible')::boolean IS DISTINCT FROM urgent
   OR outcome IS NULL OR outcome NOT IN ('completed','late_cancellation','removed') THEN RAISE EXCEPTION 'invalid_v2_execution_receipt'; END IF;
  delay=(r->>'arrivalDelayMinutes')::numeric;
  IF delay<0 OR (outcome='late_cancellation' AND delay<>0)
   OR (outcome='completed' AND delay>=60) THEN RAISE EXCEPTION 'invalid_v2_arrival_outcome'; END IF;
  IF outcome='removed' THEN deduction_cents=base_cents;
  ELSIF outcome='completed' AND delay>=30 THEN deduction_cents=least(base_cents,floor(delay/10)*500);
  END IF;
  IF outcome<>'completed' THEN lead_hours=0; END IF;
  IF outcome<>'removed' AND urgent THEN bonus_cents=1000; END IF;
 ELSE
  IF outcome IS DISTINCT FROM 'completed' OR r ? 'executionPolicy' OR r ? 'arrivalDelayMinutes' OR r ? 'urgentBonusEligible'
   THEN RAISE EXCEPTION 'historical_v2_execution_policy_is_unchanged'; END IF;
 END IF;
 lead_cents=round(lead_hours*(t->>'hourlyRateCents')::numeric);
 total_cents=base_cents+lead_cents+bonus_cents-deduction_cents;
 IF r->>'version' IS DISTINCT FROM 'residential-v2' OR r->>'configHash' IS DISTINCT FROM t->>'configHash'
  OR r->>'policyRevision' IS DISTINCT FROM t->>'policyRevision'
  OR r->>'role' IS DISTINCT FROM assignment_role
  OR (r->>'baseHours')::numeric IS DISTINCT FROM (t->>'baseHours')::numeric
  OR (r->>'hourlyRateCents')::numeric IS DISTINCT FROM (t->>'hourlyRateCents')::numeric
  OR (r->>'minimumBaseCents')::numeric IS DISTINCT FROM (t->>'minimumBaseCents')::numeric
  OR (r->>'hourlyBaseCents')::numeric IS DISTINCT FROM hourly_cents
  OR (r->>'minimumTopUpCents')::numeric IS DISTINCT FROM base_cents-hourly_cents
  OR (r->>'basePayCents')::numeric IS DISTINCT FROM base_cents
  OR (r->>'leadHours')::numeric IS DISTINCT FROM lead_hours
  OR (r->>'leadPayCents')::numeric IS DISTINCT FROM lead_cents
  OR (r->>'urgentBonusCents')::numeric IS DISTINCT FROM bonus_cents
  OR (r->>'lateDeductionCents')::numeric IS DISTINCT FROM deduction_cents
  OR (r->>'totalCents')::numeric IS DISTINCT FROM total_cents
  OR NEW.amount*100 IS DISTINCT FROM total_cents
  OR COALESCE(NEW.urgent_bonus_amount,0)*100 IS DISTINCT FROM bonus_cents
  OR COALESCE(NEW.laundry_bonus_amount,0)<>0
  OR COALESCE(NEW.late_deduction_amount,0)*100 IS DISTINCT FROM deduction_cents THEN RAISE EXCEPTION 'invalid_v2_payout_components'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.residential_v2_guard_receipt() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.residential_v2_guard_assignment() FROM PUBLIC,anon,authenticated;
COMMIT;
