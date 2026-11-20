-- Prospective paid rental contracts only. No historical enrollment or repricing.
-- Review/apply sequentially after 0058-0066. Production apply is owner-only.
BEGIN;
CREATE TABLE IF NOT EXISTS public.prepaid_entitlements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
 property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT, source_payment_id text NOT NULL UNIQUE,
 funded_cents integer NOT NULL CHECK(funded_cents>=50), purchase jsonb NOT NULL,
 state text NOT NULL DEFAULT 'active' CHECK(state IN('active','held')), hold_reason text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.rental_finance_contracts (
 subscription_id uuid PRIMARY KEY REFERENCES public.subscriptions(id) ON DELETE RESTRICT,
 customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
 property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
 entitlement_id uuid NOT NULL REFERENCES public.prepaid_entitlements(id) ON DELETE RESTRICT,
 policy text NOT NULL CHECK(policy='property_prepaid_separate_fee_v1'), reactivation_terms jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.prepaid_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entitlement_id uuid NOT NULL REFERENCES public.prepaid_entitlements(id) ON DELETE RESTRICT,
 job_id uuid REFERENCES public.jobs(id) ON DELETE RESTRICT, kind text NOT NULL CHECK(kind IN('funding','application','refund','reversal')),
 cents integer NOT NULL CHECK(cents<>0), identity text NOT NULL UNIQUE, actor text NOT NULL, reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind IN('funding','reversal') AND cents>0) OR (kind IN('application','refund') AND cents<0)),
 CHECK(kind<>'application' OR job_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS prepaid_one_funding ON public.prepaid_entries(entitlement_id) WHERE kind='funding';
CREATE UNIQUE INDEX IF NOT EXISTS prepaid_one_application ON public.prepaid_entries(job_id) WHERE kind='application';
CREATE TABLE IF NOT EXISTS public.prepaid_reservations (
 job_id uuid PRIMARY KEY REFERENCES public.jobs(id) ON DELETE RESTRICT,
 entitlement_id uuid NOT NULL REFERENCES public.prepaid_entitlements(id) ON DELETE RESTRICT,
 cents integer NOT NULL CHECK(cents>0), state text NOT NULL DEFAULT 'active' CHECK(state IN('active','released','applied')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS prepaid_one_active_reservation ON public.prepaid_reservations(entitlement_id) WHERE state='active';
CREATE TABLE IF NOT EXISTS public.rental_job_finances (
 job_id uuid PRIMARY KEY REFERENCES public.jobs(id) ON DELETE RESTRICT,
 subscription_id uuid NOT NULL REFERENCES public.rental_finance_contracts(subscription_id) ON DELETE RESTRICT,
 customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
 property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
 quote jsonb NOT NULL, scope text NOT NULL, completion_cents integer CHECK(completion_cents>=0),
 topup_consent_cents integer CHECK(topup_consent_cents>=0), topup_consent_actor text,
 cancellation text CHECK(cancellation IN('late_customer','timely_customer','business')),
 canceled_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((cancellation IS NULL)=(canceled_at IS NULL))
);
CREATE TABLE IF NOT EXISTS public.rental_financial_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), identity text NOT NULL UNIQUE,
 job_id uuid REFERENCES public.jobs(id) ON DELETE RESTRICT,
 entitlement_id uuid REFERENCES public.prepaid_entitlements(id) ON DELETE RESTRICT,
 kind text NOT NULL CHECK(kind IN('clean_payment','late_fee','credit_refund','fee_refund')),
 cents integer NOT NULL CHECK(cents>0), params jsonb NOT NULL,
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN('prepared','submitting','processing','requires_action','paid','failed','unknown','review','waived','refunded')),
 provider_id text UNIQUE, token uuid, claimed_at timestamptz, last_error text,
 actor text NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(job_id IS NOT NULL OR entitlement_id IS NOT NULL),
 CHECK(kind<>'late_fee' OR job_id IS NOT NULL),
 CHECK(kind<>'credit_refund' OR entitlement_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS public.rental_finance_notices (
 identity text PRIMARY KEY, customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
 job_id uuid REFERENCES public.jobs(id) ON DELETE RESTRICT, subject text NOT NULL, lines jsonb NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','claimed','sent','failed','unknown','skipped')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prepaid_owner_property ON public.prepaid_entitlements(customer_id,property_id);
CREATE TABLE IF NOT EXISTS public.rental_finance_audit (
 identity text PRIMARY KEY, job_id uuid REFERENCES public.jobs(id) ON DELETE RESTRICT,
 entitlement_id uuid REFERENCES public.prepaid_entitlements(id) ON DELETE RESTRICT,
 actor text NOT NULL, action text NOT NULL, reason text NOT NULL, details jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rental_finance_audit_job ON public.rental_finance_audit(job_id);
CREATE INDEX IF NOT EXISTS rental_finance_audit_entitlement ON public.rental_finance_audit(entitlement_id);
CREATE INDEX IF NOT EXISTS prepaid_entries_entitlement ON public.prepaid_entries(entitlement_id);
CREATE INDEX IF NOT EXISTS prepaid_entries_job ON public.prepaid_entries(job_id);
CREATE INDEX IF NOT EXISTS prepaid_reservations_entitlement ON public.prepaid_reservations(entitlement_id);
CREATE INDEX IF NOT EXISTS rental_finance_entitlement ON public.rental_finance_contracts(entitlement_id);
CREATE UNIQUE INDEX IF NOT EXISTS rental_finance_reactivation_request ON public.rental_finance_contracts((reactivation_terms->>'requestId')) WHERE reactivation_terms IS NOT NULL;
CREATE INDEX IF NOT EXISTS rental_finance_contract_owner ON public.rental_finance_contracts(customer_id,property_id);
CREATE INDEX IF NOT EXISTS rental_finance_job_subscription ON public.rental_job_finances(subscription_id);
CREATE INDEX IF NOT EXISTS rental_finance_job_owner ON public.rental_job_finances(customer_id,property_id);
CREATE INDEX IF NOT EXISTS rental_finance_operation_job ON public.rental_financial_operations(job_id);
CREATE INDEX IF NOT EXISTS rental_finance_operation_entitlement ON public.rental_financial_operations(entitlement_id);
CREATE INDEX IF NOT EXISTS rental_finance_operation_state ON public.rental_financial_operations(state);
CREATE INDEX IF NOT EXISTS rental_finance_notice_customer ON public.rental_finance_notices(customer_id);
CREATE INDEX IF NOT EXISTS rental_finance_notice_job ON public.rental_finance_notices(job_id);

CREATE OR REPLACE FUNCTION public.protect_prepaid_history() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Financial history cannot be deleted'; END IF;
 IF TG_TABLE_NAME IN('prepaid_entries','rental_finance_contracts','rental_finance_audit') THEN RAISE EXCEPTION 'Financial history is append only'; END IF;
 IF TG_TABLE_NAME='prepaid_entitlements' THEN
  IF (to_jsonb(NEW)-'state'-'hold_reason') IS DISTINCT FROM (to_jsonb(OLD)-'state'-'hold_reason') THEN RAISE EXCEPTION 'Prepayment provenance is immutable'; END IF;
 ELSIF TG_TABLE_NAME='prepaid_reservations' THEN
  IF (to_jsonb(NEW)-'state') IS DISTINCT FROM (to_jsonb(OLD)-'state') OR OLD.state<>'active' OR NEW.state NOT IN('released','applied') THEN RAISE EXCEPTION 'Reservation is immutable or terminal'; END IF;
 ELSIF TG_TABLE_NAME='rental_job_finances' THEN
  IF NEW.job_id<>OLD.job_id OR NEW.subscription_id<>OLD.subscription_id OR NEW.customer_id<>OLD.customer_id OR NEW.property_id<>OLD.property_id
   OR NEW.quote<>OLD.quote OR NEW.scope<>OLD.scope OR NEW.created_at<>OLD.created_at
   OR (OLD.completion_cents IS NOT NULL AND NEW.completion_cents IS DISTINCT FROM OLD.completion_cents)
   OR (OLD.cancellation IS NOT NULL AND (NEW.cancellation IS DISTINCT FROM OLD.cancellation OR NEW.canceled_at IS DISTINCT FROM OLD.canceled_at))
   THEN RAISE EXCEPTION 'Financial contract is immutable'; END IF;
 ELSIF TG_TABLE_NAME='rental_financial_operations' THEN
  IF (to_jsonb(NEW)-'state'-'provider_id'-'token'-'claimed_at'-'last_error') IS DISTINCT FROM (to_jsonb(OLD)-'state'-'provider_id'-'token'-'claimed_at'-'last_error')
   OR (OLD.provider_id IS NOT NULL AND NEW.provider_id IS DISTINCT FROM OLD.provider_id)
   OR (OLD.state IN('waived','refunded') AND NEW.state<>OLD.state) THEN RAISE EXCEPTION 'Provider operation identity is immutable'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.check_prepaid_movement() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE e public.prepaid_entitlements; balance bigint; reserved bigint; j public.jobs;
BEGIN
 SELECT * INTO e FROM public.prepaid_entitlements WHERE id=NEW.entitlement_id FOR UPDATE;
 IF e.id IS NULL THEN RAISE EXCEPTION 'Missing prepayment'; END IF;
 SELECT coalesce(sum(cents),0) INTO balance FROM public.prepaid_entries WHERE entitlement_id=e.id;
 SELECT coalesce(sum(cents),0) INTO reserved FROM public.prepaid_reservations WHERE entitlement_id=e.id AND state='active';
 IF NEW.job_id IS NOT NULL THEN
  SELECT * INTO j FROM public.jobs WHERE id=NEW.job_id;
  IF j.property_id<>e.property_id OR NOT EXISTS(SELECT 1 FROM public.properties p WHERE p.id=j.property_id AND p.customer_id=e.customer_id)
   THEN RAISE EXCEPTION 'Prepayment owner/property mismatch'; END IF;
 END IF;
 IF TG_TABLE_NAME='prepaid_entries' THEN
  IF NEW.kind='funding' AND (NEW.cents<>e.funded_cents OR balance<>0) THEN RAISE EXCEPTION 'Invalid funding'; END IF;
  IF NEW.kind='application' AND (e.state<>'active' OR j.status::text<>'awaiting_capture' OR NOT EXISTS(SELECT 1 FROM public.evidence_packets p WHERE p.job_id=j.id AND p.final_evidence_submitted_at IS NOT NULL AND p.status::text='complete')
    OR NOT EXISTS(SELECT 1 FROM public.prepaid_reservations r WHERE r.job_id=j.id AND r.entitlement_id=e.id AND r.state='active' AND r.cents=-NEW.cents)) THEN RAISE EXCEPTION 'Credit application requires canonical final evidence and reservation'; END IF;
  IF NEW.kind='refund' AND NOT EXISTS(SELECT 1 FROM public.rental_financial_operations o WHERE o.identity=NEW.identity AND o.entitlement_id=e.id AND o.kind='credit_refund' AND o.state='paid' AND o.cents=-NEW.cents) THEN RAISE EXCEPTION 'Refund is not confirmed'; END IF;
  IF balance+NEW.cents<0 OR balance+NEW.cents>e.funded_cents THEN RAISE EXCEPTION 'Prepayment balance out of bounds'; END IF;
  IF NEW.kind='refund' AND balance+NEW.cents<reserved THEN RAISE EXCEPTION 'Reserved credit cannot be refunded'; END IF;
 ELSE
  IF NEW.state='active' AND (e.state<>'active' OR NEW.cents>balance OR j.status::text NOT IN('assigned','in-progress','completed_pending_evidence','awaiting_capture')) THEN RAISE EXCEPTION 'Credit unavailable for reservation'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.guard_rental_financial_job() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.rental_finance_contracts c WHERE c.subscription_id=OLD.subscription_id) THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Enrolled financial jobs must retain their history'; END IF;
  IF NEW.property_id IS DISTINCT FROM OLD.property_id OR NEW.subscription_id IS DISTINCT FROM OLD.subscription_id THEN RAISE EXCEPTION 'Financial job ownership is immutable'; END IF;
  IF NEW.promo_code_id IS DISTINCT FROM OLD.promo_code_id AND EXISTS(SELECT 1 FROM public.rental_job_finances WHERE job_id=OLD.id) THEN RAISE EXCEPTION 'Financial quote promo is frozen'; END IF;
  IF (NEW.payment_intent_id IS DISTINCT FROM OLD.payment_intent_id OR NEW.payment_status IS DISTINCT FROM OLD.payment_status OR
    (NEW.status::text IN('canceled','completed') AND NEW.status IS DISTINCT FROM OLD.status)) AND current_setting('cleannami.rental_finance',true) IS DISTINCT FROM 'v1'
    THEN RAISE EXCEPTION 'Enrolled job requires prepaid/separate-fee handling'; END IF;
  IF NEW.payment_intent_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.prepaid_entitlements WHERE source_payment_id=NEW.payment_intent_id) THEN RAISE EXCEPTION 'Prepayment purchase cannot be a job charge'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.check_rental_finance_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE c public.rental_finance_contracts; s public.subscriptions; e public.prepaid_entitlements;
BEGIN
 IF TG_TABLE_NAME='rental_finance_contracts' THEN
  SELECT * INTO s FROM public.subscriptions WHERE id=NEW.subscription_id;
  SELECT * INTO e FROM public.prepaid_entitlements WHERE id=NEW.entitlement_id;
  IF s.customer_id<>NEW.customer_id OR s.property_id<>NEW.property_id OR e.customer_id<>NEW.customer_id OR e.property_id<>NEW.property_id
    OR NOT EXISTS(SELECT 1 FROM public.properties WHERE id=NEW.property_id AND customer_id=NEW.customer_id) THEN RAISE EXCEPTION 'Financial contract ownership mismatch'; END IF;
  IF NEW.reactivation_terms IS NULL THEN
   IF s.first_clean_payment_id IS DISTINCT FROM e.source_payment_id THEN RAISE EXCEPTION 'Funding provenance mismatch'; END IF;
  ELSE
   IF s.start_date IS DISTINCT FROM (NEW.reactivation_terms->>'startDate')::date OR s.end_date IS DISTINCT FROM (NEW.reactivation_terms->>'endDate')::date
    OR s.end_date<s.start_date+30 OR s.first_clean_payment_id IS NOT NULL THEN RAISE EXCEPTION 'Reactivation term mismatch'; END IF;
  END IF;
 ELSE
  SELECT * INTO c FROM public.rental_finance_contracts WHERE subscription_id=NEW.subscription_id;
  IF c.reactivation_terms IS NOT NULL AND NEW.check_in_time IS NOT NULL AND
    ((NEW.check_in_time AT TIME ZONE 'America/New_York')::date NOT BETWEEN (c.reactivation_terms->>'startDate')::date AND (c.reactivation_terms->>'endDate')::date) THEN RAISE EXCEPTION 'Clean is outside reactivated term'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.guard_rental_subscription_contract() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.rental_finance_contracts WHERE subscription_id=OLD.id) THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Financial subscription history must be retained'; END IF;
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.property_id IS DISTINCT FROM OLD.property_id OR NEW.start_date IS DISTINCT FROM OLD.start_date
   OR NEW.end_date IS DISTINCT FROM OLD.end_date OR NEW.duration_months IS DISTINCT FROM OLD.duration_months OR NEW.first_clean_payment_id IS DISTINCT FROM OLD.first_clean_payment_id THEN
    RAISE EXCEPTION 'Accepted financial subscription terms are immutable; create an explicit new term';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['prepaid_entitlements','rental_finance_contracts','prepaid_entries','prepaid_reservations','rental_job_finances','rental_financial_operations','rental_finance_audit'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS protect_prepaid_history ON public.%I',t);
  EXECUTE format('CREATE TRIGGER protect_prepaid_history BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.protect_prepaid_history()',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['prepaid_entitlements','rental_finance_contracts','prepaid_entries','prepaid_reservations','rental_job_finances','rental_financial_operations','rental_finance_notices','rental_finance_audit'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
 END LOOP;
END $$;
DROP TRIGGER IF EXISTS check_prepaid_entry ON public.prepaid_entries;
CREATE TRIGGER check_prepaid_entry BEFORE INSERT ON public.prepaid_entries FOR EACH ROW EXECUTE FUNCTION public.check_prepaid_movement();
DROP TRIGGER IF EXISTS check_prepaid_reservation ON public.prepaid_reservations;
CREATE TRIGGER check_prepaid_reservation BEFORE INSERT ON public.prepaid_reservations FOR EACH ROW EXECUTE FUNCTION public.check_prepaid_movement();
DROP TRIGGER IF EXISTS guard_rental_financial_job ON public.jobs;
CREATE TRIGGER guard_rental_financial_job BEFORE UPDATE OR DELETE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.guard_rental_financial_job();
DROP TRIGGER IF EXISTS check_rental_finance_identity ON public.rental_finance_contracts;
CREATE TRIGGER check_rental_finance_identity BEFORE INSERT ON public.rental_finance_contracts FOR EACH ROW EXECUTE FUNCTION public.check_rental_finance_identity();
DROP TRIGGER IF EXISTS check_reactivated_job_dates ON public.jobs;
CREATE TRIGGER check_reactivated_job_dates BEFORE INSERT OR UPDATE OF check_in_time,subscription_id ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.check_rental_finance_identity();
DROP TRIGGER IF EXISTS guard_rental_subscription_contract ON public.subscriptions;
CREATE TRIGGER guard_rental_subscription_contract BEFORE UPDATE OR DELETE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.guard_rental_subscription_contract();
REVOKE ALL ON FUNCTION public.protect_prepaid_history(),public.check_prepaid_movement(),public.guard_rental_financial_job(),public.check_rental_finance_identity(),public.guard_rental_subscription_contract() FROM PUBLIC,anon,authenticated;
COMMIT;
