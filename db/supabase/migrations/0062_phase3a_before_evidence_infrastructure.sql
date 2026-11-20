-- OWNER REVIEW/APPLY ONLY. Optional Before infrastructure; no mandatory minimums,
-- start-cleaning gate, exception policy, historical relabeling or money changes.
BEGIN;
CREATE TABLE IF NOT EXISTS public.evidence_upload_phases (
 upload_id uuid PRIMARY KEY REFERENCES public.evidence_upload_manifest(upload_id),
 phase text NOT NULL CHECK(phase IN ('before','after'))
);
CREATE TABLE IF NOT EXISTS public.job_arrival_conditions (
 job_id uuid PRIMARY KEY REFERENCES public.job_execution_contracts(job_id),
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0), notes text NOT NULL DEFAULT '' CHECK(length(notes)<=4000),
 updated_by uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.evidence_upload_phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_arrival_conditions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.evidence_upload_phases,public.job_arrival_conditions FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.phase3a_guard_photo_phase() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'photo_phase_immutable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.evidence_upload_manifest WHERE upload_id=NEW.upload_id AND state='reserved'
   AND ((NEW.phase='before')=(position('/issued-before/' IN path)>0)))
 THEN RAISE EXCEPTION 'photo_phase_requires_new_reservation'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS phase3a_guard_photo_phase ON public.evidence_upload_phases;
CREATE TRIGGER phase3a_guard_photo_phase BEFORE INSERT OR UPDATE OR DELETE ON public.evidence_upload_phases FOR EACH ROW EXECUTE FUNCTION public.phase3a_guard_photo_phase();
REVOKE ALL ON FUNCTION public.phase3a_guard_photo_phase() FROM PUBLIC,anon,authenticated;
COMMIT;
