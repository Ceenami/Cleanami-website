-- Standalone production-baseline hotfix. OWNER-OPERATED; no backfill.
-- Apply before Phase 2C 0049-0051. Do not run a lexical migration runner.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
  IF to_regclass('public.jobs') IS NULL OR to_regclass('public.evidence_packets') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='evidence_packets' AND column_name='final_evidence_submitted_at')
  THEN RAISE EXCEPTION '0052 requires the production job/evidence baseline'; END IF;
END $$;

-- Refuse silently adopting a pre-existing incompatible table with the same name.
DO $$ DECLARE target text; BEGIN
  FOREACH target IN ARRAY ARRAY['job_execution_contracts','evidence_upload_manifest','job_evidence_drafts','job_operation_audit'] LOOP
    IF to_regclass('public.' || target) IS NOT NULL AND obj_description(to_regclass('public.' || target),'pg_class') IS DISTINCT FROM 'pre2c-hotfix-v1:0052' THEN
      RAISE EXCEPTION '0052 refuses incompatible existing table %',target;
    END IF;
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS public.job_execution_contracts (
  job_id uuid PRIMARY KEY REFERENCES public.jobs(id),
  protocol text NOT NULL CHECK (protocol='pre2c-hotfix-v1'),
  terms jsonb NOT NULL CHECK (jsonb_typeof(terms)='object' AND terms->>'protocol'='pre2c-hotfix-v1'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.evidence_upload_manifest (
  upload_id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.job_execution_contracts(job_id),
  cleaner_id uuid NOT NULL REFERENCES public.cleaners(id),
  room_key text NOT NULL CHECK (room_key ~ '^[a-z0-9-]+$'),
  path text NOT NULL,
  captured_at timestamptz NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size>0 AND byte_size<=10485760),
  mime text NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp')),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','verified','removed')),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (state<>'verified' OR verified_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS evidence_upload_path_uidx ON public.evidence_upload_manifest(path);
CREATE INDEX IF NOT EXISTS evidence_upload_job_idx ON public.evidence_upload_manifest(job_id);
-- 21 October client direction: camera and existing images count equally.
-- Imported capture time is unknown; never replace it with selection/upload time.
ALTER TABLE public.evidence_upload_manifest ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'camera';
ALTER TABLE public.evidence_upload_manifest ALTER COLUMN captured_at DROP NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.evidence_upload_manifest'::regclass AND conname='evidence_upload_source_check') THEN
    ALTER TABLE public.evidence_upload_manifest ADD CONSTRAINT evidence_upload_source_check CHECK (
      (source='camera' AND captured_at IS NOT NULL) OR
      (source='gallery' AND captured_at IS NULL)
    );
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.job_evidence_drafts (
  job_id uuid PRIMARY KEY REFERENCES public.job_execution_contracts(job_id),
  revision integer NOT NULL DEFAULT 0 CHECK (revision>=0),
  items jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(items)='array'),
  notes text NOT NULL DEFAULT '', final_hash text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.job_operation_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.job_execution_contracts(job_id),
  operation text NOT NULL, identity text NOT NULL, actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS job_operation_identity_uidx ON public.job_operation_audit(job_id,operation,identity);

COMMENT ON TABLE public.job_execution_contracts IS 'pre2c-hotfix-v1:0052';
COMMENT ON TABLE public.evidence_upload_manifest IS 'pre2c-hotfix-v1:0052';
COMMENT ON TABLE public.job_evidence_drafts IS 'pre2c-hotfix-v1:0052';
COMMENT ON TABLE public.job_operation_audit IS 'pre2c-hotfix-v1:0052';

ALTER TABLE public.job_execution_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_upload_manifest ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_evidence_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_operation_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_execution_contracts,public.evidence_upload_manifest,public.job_evidence_drafts,public.job_operation_audit FROM PUBLIC,anon,authenticated;
-- Application uses the server database role; the service role is server-only too.
GRANT SELECT,INSERT ON public.job_execution_contracts,public.job_operation_audit TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.evidence_upload_manifest,public.job_evidence_drafts TO service_role;

CREATE SCHEMA IF NOT EXISTS job_execution_private;
REVOKE ALL ON SCHEMA job_execution_private FROM PUBLIC,anon,authenticated;
-- Transaction-local insertion receipts also work inside booking savepoints. xmin
-- alone is insufficient: updates change xmin, and a savepoint uses a subtransaction ID.
CREATE OR REPLACE FUNCTION job_execution_private.mark_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog,public AS $$
BEGIN
  PERFORM set_config('cleannami.execution_insert_receipts',coalesce(current_setting('cleannami.execution_insert_receipts',true),'') || ',' || NEW.id::text,true);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION job_execution_private.mark_insert() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS job_execution_insert_receipt ON public.jobs;
CREATE TRIGGER job_execution_insert_receipt AFTER INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION job_execution_private.mark_insert();
CREATE OR REPLACE FUNCTION job_execution_private.contract_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Issued execution contracts are immutable'; END IF;
  -- The referenced job must have been inserted in this transaction. Never enroll old IDs.
  IF NOT NEW.job_id::text = ANY(string_to_array(coalesce(current_setting('cleannami.execution_insert_receipts',true),''),','))
  THEN RAISE EXCEPTION 'Execution contract requires a newly inserted job'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION job_execution_private.contract_guard() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS job_execution_contract_guard ON public.job_execution_contracts;
CREATE TRIGGER job_execution_contract_guard BEFORE INSERT OR UPDATE OR DELETE ON public.job_execution_contracts FOR EACH ROW EXECUTE FUNCTION job_execution_private.contract_guard();

CREATE OR REPLACE FUNCTION job_execution_private.row_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE target_id uuid;
BEGIN
  IF TG_TABLE_NAME='jobs' THEN target_id=OLD.id;
  ELSIF TG_OP='INSERT' THEN target_id=NEW.job_id;
  ELSE target_id=OLD.job_id; END IF;
  IF TG_TABLE_NAME='evidence_packets' AND TG_OP='UPDATE' THEN
    IF NEW.job_id IS DISTINCT FROM OLD.job_id AND EXISTS (SELECT 1 FROM public.job_execution_contracts WHERE job_id IN (OLD.job_id,NEW.job_id)) THEN
      RAISE EXCEPTION 'Issued evidence job identity is immutable';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.job_execution_contracts WHERE job_id=target_id) THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF current_setting('role',true) IN ('anon','authenticated') THEN
    RAISE EXCEPTION 'Issued jobs require the authenticated application API';
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Issued execution history cannot be deleted'; END IF;
  IF TG_TABLE_NAME='jobs' THEN
    IF NEW.check_in_time IS DISTINCT FROM OLD.check_in_time OR NEW.check_out_time IS DISTINCT FROM OLD.check_out_time OR NEW.calendar_event_uid IS DISTINCT FROM OLD.calendar_event_uid OR NEW.checklist_snapshot IS DISTINCT FROM OLD.checklist_snapshot OR NEW.addons_snapshot IS DISTINCT FROM OLD.addons_snapshot OR NEW.expected_hours IS DISTINCT FROM OLD.expected_hours OR NEW.property_id IS DISTINCT FROM OLD.property_id OR NEW.service_type IS DISTINCT FROM OLD.service_type OR NEW.job_source IS DISTINCT FROM OLD.job_source OR NEW.subscription_id IS DISTINCT FROM OLD.subscription_id THEN
      RAISE EXCEPTION 'Issued schedule and acceptance terms are frozen';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NOT (
        (OLD.status='unassigned' AND NEW.status IN ('assigned','canceled')) OR
        (OLD.status='assigned' AND NEW.status IN ('unassigned','in-progress','canceled')) OR
        (OLD.status='in-progress' AND NEW.status='completed_pending_evidence') OR
        (OLD.status='completed_pending_evidence' AND NEW.status='awaiting_capture') OR
        (OLD.status='awaiting_capture' AND NEW.status='completed')
      ) OR NEW.status IS NULL THEN RAISE EXCEPTION 'Invalid issued-job transition'; END IF;
      IF OLD.status IN ('canceled','completed') THEN RAISE EXCEPTION 'Terminal job cannot reopen'; END IF;
      IF NEW.status='canceled' AND (OLD.status NOT IN ('unassigned','assigned') OR EXISTS (SELECT 1 FROM public.evidence_packets WHERE job_id=target_id AND gps_check_in_timestamp IS NOT NULL)) THEN RAISE EXCEPTION 'Started job cancellation needs separate review'; END IF;
      IF NEW.status='in-progress' AND (OLD.status<>'assigned' OR NOT EXISTS (SELECT 1 FROM public.evidence_packets WHERE job_id=target_id AND gps_check_in_timestamp IS NOT NULL AND gps_check_out_timestamp IS NULL)) THEN RAISE EXCEPTION 'First arrival required'; END IF;
      IF NEW.status='completed_pending_evidence' AND NOT EXISTS (SELECT 1 FROM public.evidence_packets WHERE job_id=target_id AND gps_check_in_timestamp IS NOT NULL AND gps_check_out_timestamp IS NOT NULL) THEN RAISE EXCEPTION 'Real departure required'; END IF;
      IF NEW.status IN ('awaiting_capture','completed') AND NOT EXISTS (SELECT 1 FROM public.evidence_packets WHERE job_id=target_id AND final_evidence_submitted_at IS NOT NULL AND status='complete') THEN RAISE EXCEPTION 'Final evidence required'; END IF;
      IF NEW.status='completed' AND NEW.payment_status IS DISTINCT FROM 'captured' THEN RAISE EXCEPTION 'Settlement required'; END IF;
    END IF;
  END IF;
  IF TG_TABLE_NAME='evidence_packets' THEN
    IF TG_OP='UPDATE' THEN
      IF OLD.gps_check_in_timestamp IS NOT NULL AND NEW.gps_check_in_timestamp IS DISTINCT FROM OLD.gps_check_in_timestamp THEN RAISE EXCEPTION 'First arrival is immutable'; END IF;
      IF OLD.gps_check_out_timestamp IS NOT NULL AND NEW.gps_check_out_timestamp IS DISTINCT FROM OLD.gps_check_out_timestamp THEN RAISE EXCEPTION 'First departure is immutable'; END IF;
      IF OLD.final_evidence_submitted_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Final evidence is immutable'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION job_execution_private.row_guard() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS job_execution_row_guard ON public.jobs;
CREATE TRIGGER job_execution_row_guard BEFORE UPDATE OR DELETE ON public.jobs FOR EACH ROW EXECUTE FUNCTION job_execution_private.row_guard();
DROP TRIGGER IF EXISTS job_execution_evidence_guard ON public.evidence_packets;
CREATE TRIGGER job_execution_evidence_guard BEFORE INSERT OR UPDATE OR DELETE ON public.evidence_packets FOR EACH ROW EXECUTE FUNCTION job_execution_private.row_guard();

CREATE OR REPLACE FUNCTION job_execution_private.assignment_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE target_id uuid;
BEGIN
  IF TG_OP='INSERT' THEN target_id=NEW.job_id; ELSE target_id=OLD.job_id; END IF;
  IF EXISTS (SELECT 1 FROM public.job_execution_contracts WHERE job_id=target_id) THEN
    PERFORM 1 FROM public.jobs WHERE id=target_id FOR UPDATE;
    IF TG_OP<>'DELETE' AND EXISTS (SELECT 1 FROM public.jobs WHERE id=target_id AND status='canceled') THEN RAISE EXCEPTION 'Canceled jobs cannot receive assignments'; END IF;
    IF current_setting('role',true) IN ('anon','authenticated') OR EXISTS (SELECT 1 FROM public.jobs WHERE id=target_id AND status NOT IN ('assigned','unassigned','canceled')) OR EXISTS (SELECT 1 FROM public.evidence_packets WHERE job_id=target_id AND gps_check_in_timestamp IS NOT NULL) THEN
      RAISE EXCEPTION 'Working visit assignments are frozen; operations review required';
    END IF;
  END IF;
  IF TG_OP='UPDATE' AND NEW.job_id IS DISTINCT FROM OLD.job_id THEN
    IF EXISTS (SELECT 1 FROM public.job_execution_contracts WHERE job_id=NEW.job_id) THEN RAISE EXCEPTION 'Use a new assignment for an issued job'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
REVOKE ALL ON FUNCTION job_execution_private.assignment_guard() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS job_execution_assignment_guard ON public.jobs_to_cleaners;
CREATE TRIGGER job_execution_assignment_guard BEFORE INSERT OR UPDATE OR DELETE ON public.jobs_to_cleaners FOR EACH ROW EXECUTE FUNCTION job_execution_private.assignment_guard();
COMMIT;
