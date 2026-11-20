-- Owner apply only; requires 0052 and 0062. No existing-job enrollment or activation.
BEGIN;
CREATE TABLE IF NOT EXISTS public.job_before_requirements (
  job_id uuid PRIMARY KEY REFERENCES public.job_execution_contracts(job_id),
  rooms jsonb NOT NULL CHECK (jsonb_typeof(rooms)='array' AND jsonb_array_length(rooms)>0),
  started_at timestamptz, started_by text, evidence jsonb NOT NULL DEFAULT '[]',
  exception_reason text, exception_by text, exception_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((started_at IS NULL) = (started_by IS NULL)),
  CHECK ((exception_at IS NULL AND exception_reason IS NULL AND exception_by IS NULL)
    OR (exception_at IS NOT NULL AND exception_by IS NOT NULL AND length(trim(exception_reason)) BETWEEN 10 AND 1000))
);
ALTER TABLE public.job_before_requirements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_before_requirements FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.guard_before_requirements() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE expected jsonb;
BEGIN
 IF TG_OP='INSERT' THEN
   SELECT coalesce(jsonb_agg(r ORDER BY ordinal),'[]') INTO expected FROM public.job_execution_contracts c,
     jsonb_array_elements(c.terms->'rooms') WITH ORDINALITY AS x(r,ordinal) WHERE c.job_id=NEW.job_id AND r->>'roomKey'<>'laundry';
   IF NEW.rooms IS DISTINCT FROM expected THEN RAISE EXCEPTION 'before_requirements_must_match_issued_rooms'; END IF;
 ELSE
   IF NEW.job_id IS DISTINCT FROM OLD.job_id OR NEW.rooms IS DISTINCT FROM OLD.rooms OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.started_at IS NOT NULL AND (NEW.started_at IS DISTINCT FROM OLD.started_at OR NEW.started_by IS DISTINCT FROM OLD.started_by OR NEW.evidence IS DISTINCT FROM OLD.evidence))
     OR (OLD.exception_at IS NOT NULL AND (NEW.exception_at IS DISTINCT FROM OLD.exception_at OR NEW.exception_by IS DISTINCT FROM OLD.exception_by OR NEW.exception_reason IS DISTINCT FROM OLD.exception_reason))
   THEN RAISE EXCEPTION 'before_contract_is_immutable'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_before_requirements() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_before_requirements ON public.job_before_requirements;
CREATE TRIGGER guard_before_requirements BEFORE INSERT OR UPDATE ON public.job_before_requirements FOR EACH ROW EXECUTE FUNCTION public.guard_before_requirements();
CREATE OR REPLACE FUNCTION public.protect_started_before_evidence() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE target uuid; object_path text;
BEGIN
 target=CASE WHEN TG_OP='INSERT' THEN NEW.job_id ELSE OLD.job_id END;
 object_path=CASE WHEN TG_OP='INSERT' THEN NEW.path ELSE OLD.path END;
 -- Serialize with the parent lock used for start, reservation and finalization.
 PERFORM 1 FROM public.jobs WHERE id=target FOR UPDATE;
 IF TG_OP='INSERT' AND object_path NOT LIKE '%/issued-before/%' AND EXISTS(SELECT 1 FROM public.job_before_requirements WHERE job_id=target AND started_at IS NULL AND exception_at IS NULL)
 THEN RAISE EXCEPTION 'required_before_start_missing'; END IF;
 IF object_path LIKE '%/issued-before/%' AND EXISTS(SELECT 1 FROM public.job_before_requirements WHERE job_id=target AND started_at IS NOT NULL) THEN
   IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'started_before_evidence_is_immutable'; END IF;
   IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'started_before_evidence_is_immutable'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.protect_started_before_evidence() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS protect_started_before_evidence ON public.evidence_upload_manifest;
CREATE TRIGGER protect_started_before_evidence BEFORE INSERT OR UPDATE OR DELETE ON public.evidence_upload_manifest FOR EACH ROW EXECUTE FUNCTION public.protect_started_before_evidence();
CREATE OR REPLACE FUNCTION public.require_before_for_final_evidence() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM 1 FROM public.jobs WHERE id=NEW.job_id FOR UPDATE;
 IF NEW.final_evidence_submitted_at IS NOT NULL AND EXISTS(SELECT 1 FROM public.job_before_requirements WHERE job_id=NEW.job_id AND started_at IS NULL AND exception_at IS NULL)
 THEN RAISE EXCEPTION 'required_before_start_missing'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.require_before_for_final_evidence() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS require_before_for_final_evidence ON public.evidence_packets;
CREATE TRIGGER require_before_for_final_evidence BEFORE INSERT OR UPDATE ON public.evidence_packets FOR EACH ROW EXECUTE FUNCTION public.require_before_for_final_evidence();
COMMIT;
