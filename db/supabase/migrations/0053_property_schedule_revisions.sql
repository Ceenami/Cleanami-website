-- Requires migration 0052. Apply manually.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
  IF to_regclass('public.job_execution_contracts') IS NULL THEN
    RAISE EXCEPTION 'Apply 0052 before 0053';
  END IF;
  IF to_regclass('public.job_schedule_revisions') IS NOT NULL AND obj_description(to_regclass('public.job_schedule_revisions')) IS DISTINCT FROM 'cleannami.property-schedule.v1' THEN
    RAISE EXCEPTION 'Incompatible pre-existing schedule revisions table';
  END IF;
  IF to_regclass('public.job_schedule_notices') IS NOT NULL AND obj_description(to_regclass('public.job_schedule_notices')) IS DISTINCT FROM 'cleannami.property-schedule-notices.v1' THEN
    RAISE EXCEPTION 'Incompatible pre-existing schedule notices table';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.job_schedule_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Deliberately no FK: legacy cancellation archives and deletes jobs. Keep
  -- their revision audit by original UUID without changing cancellation policy.
  job_id uuid NOT NULL,
  source text NOT NULL CHECK (source IN ('property_defaults','manual')),
  before_start timestamptz NOT NULL,
  before_deadline timestamptz NOT NULL,
  planned_start timestamptz NOT NULL,
  planned_deadline timestamptz NOT NULL,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source <> 'property_defaults' OR planned_deadline > planned_start)
);
COMMENT ON TABLE public.job_schedule_revisions IS 'cleannami.property-schedule.v1';
CREATE INDEX IF NOT EXISTS job_schedule_revision_job_idx ON public.job_schedule_revisions(job_id,created_at);
ALTER TABLE public.job_schedule_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_schedule_revisions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.job_schedule_revisions TO service_role;

CREATE TABLE IF NOT EXISTS public.job_schedule_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id uuid NOT NULL REFERENCES public.job_schedule_revisions(id),
  cleaner_id uuid NOT NULL,
  user_id uuid NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  sent_at timestamptz
);
COMMENT ON TABLE public.job_schedule_notices IS 'cleannami.property-schedule-notices.v1';
CREATE INDEX IF NOT EXISTS job_schedule_notice_pending_idx ON public.job_schedule_notices(sent_at,created_at);
ALTER TABLE public.job_schedule_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_schedule_notices FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.job_schedule_notices TO service_role;

CREATE OR REPLACE FUNCTION job_execution_private.schedule_revision_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j public.jobs;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Schedule revisions are immutable'; END IF;
  IF NEW.source='manual' THEN
    IF NOT EXISTS (SELECT 1 FROM public.jobs WHERE id=NEW.job_id AND check_in_time=NEW.planned_start AND check_out_time=NEW.planned_deadline)
    THEN RAISE EXCEPTION 'Manual revision requires the existing booking schedule'; END IF;
    RETURN NEW;
  END IF;
  IF current_setting('role',true) IN ('anon','authenticated') THEN
    RAISE EXCEPTION 'Schedule changes require the authenticated application API';
  END IF;
  SELECT * INTO j FROM public.jobs WHERE id=NEW.job_id FOR UPDATE;
  IF NOT FOUND OR j.status NOT IN ('assigned','unassigned') OR j.status IS NULL
     OR j.service_type <> 'vacation_rental_subscription'
     OR j.check_in_time <= clock_timestamp() OR NEW.planned_start <= clock_timestamp()
     OR j.check_in_time IS DISTINCT FROM NEW.before_start
     OR j.check_out_time IS DISTINCT FROM NEW.before_deadline
     OR j.expected_hours IS NULL OR j.expected_hours <= 0
     OR NEW.planned_deadline - NEW.planned_start < j.expected_hours * interval '1 hour'
     OR EXISTS (SELECT 1 FROM public.evidence_packets WHERE job_id=j.id AND
       (gps_check_in_timestamp IS NOT NULL OR gps_check_out_timestamp IS NOT NULL OR final_evidence_submitted_at IS NOT NULL OR is_checklist_complete OR cardinality(photo_urls)>0))
     OR EXISTS (SELECT 1 FROM public.evidence_upload_manifest WHERE job_id=j.id AND state<>'removed')
     OR EXISTS (SELECT 1 FROM public.job_evidence_drafts WHERE job_id=j.id AND
       (notes<>'' OR EXISTS (SELECT 1 FROM jsonb_array_elements(items) item WHERE item->>'completed'='true')))
     OR EXISTS (SELECT 1 FROM public.job_schedule_revisions WHERE job_id=j.id AND source='manual')
  THEN RAISE EXCEPTION 'Booking changed or is not eligible for property-time updates'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION job_execution_private.schedule_revision_guard() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS job_schedule_revision_guard ON public.job_schedule_revisions;
CREATE TRIGGER job_schedule_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON public.job_schedule_revisions FOR EACH ROW EXECUTE FUNCTION job_execution_private.schedule_revision_guard();

CREATE OR REPLACE FUNCTION job_execution_private.apply_schedule_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE previous_receipt text;
BEGIN
  IF NEW.source='manual' THEN RETURN NEW; END IF;
  previous_receipt := coalesce(current_setting('cleannami.schedule_revision',true),'');
  PERFORM set_config('cleannami.schedule_revision',NEW.id::text,true);
  UPDATE public.jobs SET check_in_time=NEW.planned_start,check_out_time=NEW.planned_deadline,updated_at=clock_timestamp() WHERE id=NEW.job_id;
  PERFORM set_config('cleannami.schedule_revision',previous_receipt,true);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION job_execution_private.apply_schedule_revision() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS job_apply_schedule_revision ON public.job_schedule_revisions;
CREATE TRIGGER job_apply_schedule_revision AFTER INSERT ON public.job_schedule_revisions FOR EACH ROW EXECUTE FUNCTION job_execution_private.apply_schedule_revision();

-- Capture subsequent individual edits, including existing legacy edit endpoints.
CREATE OR REPLACE FUNCTION job_execution_private.track_schedule_override() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF (NEW.check_in_time IS DISTINCT FROM OLD.check_in_time OR NEW.check_out_time IS DISTINCT FROM OLD.check_out_time)
    AND OLD.check_in_time IS NOT NULL AND OLD.check_out_time IS NOT NULL
    AND NEW.check_in_time IS NOT NULL AND NEW.check_out_time IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.job_schedule_revisions r WHERE r.id::text=current_setting('cleannami.schedule_revision',true)
      AND r.job_id=NEW.id AND r.source='property_defaults' AND r.before_start=OLD.check_in_time AND r.before_deadline=OLD.check_out_time
      AND r.planned_start=NEW.check_in_time AND r.planned_deadline=NEW.check_out_time)
  THEN
    INSERT INTO public.job_schedule_revisions(job_id,source,before_start,before_deadline,planned_start,planned_deadline,actor)
      VALUES(NEW.id,'manual',OLD.check_in_time,OLD.check_out_time,NEW.check_in_time,NEW.check_out_time,'existing_workflow');
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION job_execution_private.track_schedule_override() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS job_track_schedule_override ON public.jobs;
CREATE TRIGGER job_track_schedule_override AFTER UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION job_execution_private.track_schedule_override();

-- Serialize working assignment writes with rescheduling. Only rescheduled jobs
-- introduce the overlap guard; existing same-day override policy is unchanged.
CREATE OR REPLACE FUNCTION job_execution_private.schedule_assignment_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE target_id uuid; cleaner_id_to_lock uuid; j public.jobs;
BEGIN
  IF TG_OP='DELETE' THEN target_id:=OLD.job_id; cleaner_id_to_lock:=OLD.cleaner_id;
  ELSE target_id:=NEW.job_id; cleaner_id_to_lock:=NEW.cleaner_id; END IF;
  PERFORM 1 FROM public.jobs WHERE id=target_id FOR UPDATE;
  PERFORM 1 FROM public.cleaners WHERE id IN (cleaner_id_to_lock,CASE WHEN TG_OP='UPDATE' THEN OLD.cleaner_id ELSE cleaner_id_to_lock END) ORDER BY id FOR UPDATE;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  SELECT * INTO j FROM public.jobs WHERE id=target_id;
  IF NEW.role <> 'backup' AND j.status NOT IN ('canceled','completed') AND EXISTS (
    SELECT 1 FROM public.jobs_to_cleaners a JOIN public.jobs other ON other.id=a.job_id
    WHERE a.cleaner_id=NEW.cleaner_id AND a.role<>'backup' AND other.id<>j.id
      AND other.status NOT IN ('canceled','completed')
      AND other.check_in_time < j.check_in_time + coalesce(nullif(j.expected_hours,0),4) * interval '1 hour'
      AND other.check_in_time + coalesce(nullif(other.expected_hours,0),4) * interval '1 hour' > j.check_in_time
      AND EXISTS (SELECT 1 FROM public.job_schedule_revisions r WHERE r.source='property_defaults' AND r.job_id IN (j.id,other.id))
  ) THEN RAISE EXCEPTION 'Cleaner schedule overlaps an updated booking'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION job_execution_private.schedule_assignment_guard() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS job_schedule_assignment_guard ON public.jobs_to_cleaners;
CREATE TRIGGER job_schedule_assignment_guard BEFORE INSERT OR UPDATE OR DELETE ON public.jobs_to_cleaners FOR EACH ROW EXECUTE FUNCTION job_execution_private.schedule_assignment_guard();

-- Allow the audited schedule revision through the 0052 row guard while retaining
-- the existing contract, identity, evidence and status checks.
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
    IF ((NEW.check_in_time IS DISTINCT FROM OLD.check_in_time OR NEW.check_out_time IS DISTINCT FROM OLD.check_out_time) AND NOT EXISTS (SELECT 1 FROM public.job_schedule_revisions r WHERE r.id::text=current_setting('cleannami.schedule_revision',true) AND r.job_id=OLD.id AND r.source='property_defaults' AND r.before_start=OLD.check_in_time AND r.before_deadline=OLD.check_out_time AND r.planned_start=NEW.check_in_time AND r.planned_deadline=NEW.check_out_time)) OR NEW.calendar_event_uid IS DISTINCT FROM OLD.calendar_event_uid OR NEW.checklist_snapshot IS DISTINCT FROM OLD.checklist_snapshot OR NEW.addons_snapshot IS DISTINCT FROM OLD.addons_snapshot OR NEW.expected_hours IS DISTINCT FROM OLD.expected_hours OR NEW.property_id IS DISTINCT FROM OLD.property_id OR NEW.service_type IS DISTINCT FROM OLD.service_type OR NEW.job_source IS DISTINCT FROM OLD.job_source OR NEW.subscription_id IS DISTINCT FROM OLD.subscription_id THEN
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

COMMIT;
