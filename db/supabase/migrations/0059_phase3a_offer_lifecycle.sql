-- Owner review/apply only, after 0058 and isolated TEST verification. No backfill.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='phase3a_offer_audit' AND NOT tgisinternal AND tgenabled<>'D') THEN RAISE EXCEPTION '0058 must be installed before 0059'; END IF;
END $$;
ALTER TABLE public.phase3a_offer_jobs ADD COLUMN IF NOT EXISTS lifecycle_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.phase3a_assignment_offers ADD COLUMN IF NOT EXISTS response_due_at timestamptz;
ALTER TABLE public.phase3a_assignment_offers ADD COLUMN IF NOT EXISTS response_reminder_at timestamptz;
ALTER TABLE public.phase3a_assignment_offers ADD COLUMN IF NOT EXISTS deadline_gate text;
CREATE INDEX IF NOT EXISTS phase3a_offer_due ON public.phase3a_assignment_offers(response_due_at) WHERE state='pending' AND response_due_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.phase3a_reconfirmations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 offer_id uuid NOT NULL UNIQUE REFERENCES public.phase3a_assignment_offers(id) ON DELETE CASCADE,
 schedule_version integer NOT NULL,
 planned_start timestamptz NOT NULL,
 requested_at timestamptz NOT NULL,
 reminder_at timestamptz NOT NULL,
 escalate_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','confirmed','cannot_fulfill','revoked')),
 responded_at timestamptz, revoked_at timestamptz,
 CHECK(reminder_at=requested_at+interval '2 hours')
);
CREATE TABLE IF NOT EXISTS public.phase3a_lifecycle_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 offer_id uuid NOT NULL REFERENCES public.phase3a_assignment_offers(id) ON DELETE CASCADE,
 reconfirmation_id uuid REFERENCES public.phase3a_reconfirmations(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('initial_reminder','offer_expired','immediate_admin','deadline_policy_review','reconfirmation_policy_review','reconfirmation_request','reconfirmation_reminder','reconfirmation_escalation','reconfirmation_response','eta_prompt')),
 occurred_at timestamptz NOT NULL DEFAULT now(),
 details jsonb NOT NULL DEFAULT '{}'::jsonb,
 dispatch_state text NOT NULL DEFAULT 'pending' CHECK(dispatch_state IN ('pending','claimed','sent','failed','skipped')),
 claimed_at timestamptz,
 UNIQUE(offer_id,kind)
);
CREATE INDEX IF NOT EXISTS phase3a_lifecycle_pending ON public.phase3a_lifecycle_actions(occurred_at,id) WHERE dispatch_state='pending';
CREATE INDEX IF NOT EXISTS phase3a_reconfirmation_due ON public.phase3a_reconfirmations(escalate_at) WHERE state='pending';
ALTER TABLE public.phase3a_reconfirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phase3a_lifecycle_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.phase3a_reconfirmations,public.phase3a_lifecycle_actions FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.phase3a_stamp_response_deadline() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE start_at timestamptz; lead interval; window_size interval;
BEGIN
 NEW.response_due_at=NULL; NEW.response_reminder_at=NULL; NEW.deadline_gate=NULL;
 IF NOT EXISTS(SELECT 1 FROM public.phase3a_offer_jobs WHERE job_id=NEW.job_id AND lifecycle_enabled) THEN RETURN NEW; END IF;
 SELECT check_in_time INTO start_at FROM public.jobs WHERE id=NEW.job_id;
 lead=start_at-NEW.offered_at;
 IF NEW.role='backup' THEN NEW.deadline_gate='backup_deadline_policy';
 ELSIF NEW.replaces_cleaner_id IS NOT NULL THEN NEW.deadline_gate='promotion_deadline_policy';
 ELSIF NEW.schedule_version>1 THEN NEW.deadline_gate='rescheduled_deadline_policy';
 ELSIF start_at IS NULL OR lead<interval '30 minutes' THEN NEW.deadline_gate='near_start_deadline_policy';
 ELSE
  window_size=CASE WHEN lead>interval '72 hours' THEN interval '12 hours' WHEN lead>=interval '24 hours' THEN interval '2 hours' ELSE interval '30 minutes' END;
  NEW.response_due_at=NEW.offered_at+window_size;
  NEW.response_reminder_at=NEW.offered_at+window_size/2;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS phase3a_stamp_response_deadline ON public.phase3a_assignment_offers;
CREATE TRIGGER phase3a_stamp_response_deadline BEFORE INSERT ON public.phase3a_assignment_offers FOR EACH ROW EXECUTE FUNCTION public.phase3a_stamp_response_deadline();

CREATE OR REPLACE FUNCTION public.phase3a_guard_response_deadline() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.response_due_at IS DISTINCT FROM OLD.response_due_at OR NEW.response_reminder_at IS DISTINCT FROM OLD.response_reminder_at OR NEW.deadline_gate IS DISTINCT FROM OLD.deadline_gate THEN RAISE EXCEPTION 'offer_deadline_is_immutable'; END IF;
 IF OLD.state='pending' AND NEW.state IN ('accepted','declined') AND OLD.response_due_at<=clock_timestamp() THEN RAISE EXCEPTION 'offer_response_deadline_passed'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS phase3a_guard_response_deadline ON public.phase3a_assignment_offers;
CREATE TRIGGER phase3a_guard_response_deadline BEFORE UPDATE ON public.phase3a_assignment_offers FOR EACH ROW EXECUTE FUNCTION public.phase3a_guard_response_deadline();

CREATE OR REPLACE FUNCTION public.phase3a_queue_offer_lifecycle() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE start_at timestamptz;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM public.phase3a_offer_jobs WHERE job_id=NEW.job_id AND lifecycle_enabled) THEN RETURN NEW; END IF;
  SELECT check_in_time INTO start_at FROM public.jobs WHERE id=NEW.job_id;
  IF NEW.deadline_gate IS NOT NULL THEN
   INSERT INTO public.phase3a_lifecycle_actions(offer_id,kind,details) VALUES(NEW.id,'deadline_policy_review',jsonb_build_object('reason',NEW.deadline_gate));
  ELSIF start_at<NEW.offered_at+interval '24 hours' THEN
   INSERT INTO public.phase3a_lifecycle_actions(offer_id,kind) VALUES(NEW.id,'immediate_admin');
  END IF;
 ELSIF NEW.state IS DISTINCT FROM OLD.state THEN
  UPDATE public.phase3a_lifecycle_actions SET dispatch_state='skipped' WHERE offer_id=NEW.id AND dispatch_state='pending' AND kind IN ('initial_reminder','deadline_policy_review');
  IF NEW.state='revoked' THEN
   UPDATE public.phase3a_reconfirmations SET state='revoked',revoked_at=now() WHERE offer_id=NEW.id AND state<>'revoked';
   UPDATE public.phase3a_lifecycle_actions SET dispatch_state='skipped' WHERE offer_id=NEW.id AND dispatch_state='pending';
  END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS phase3a_queue_offer_lifecycle ON public.phase3a_assignment_offers;
CREATE TRIGGER phase3a_queue_offer_lifecycle AFTER INSERT OR UPDATE ON public.phase3a_assignment_offers FOR EACH ROW EXECUTE FUNCTION public.phase3a_queue_offer_lifecycle();

CREATE OR REPLACE FUNCTION public.phase3a_guard_reconfirmation() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.id<>OLD.id OR NEW.offer_id<>OLD.offer_id OR NEW.schedule_version<>OLD.schedule_version OR NEW.planned_start<>OLD.planned_start OR NEW.requested_at<>OLD.requested_at OR NEW.reminder_at<>OLD.reminder_at OR NEW.escalate_at<>OLD.escalate_at THEN RAISE EXCEPTION 'reconfirmation_identity_immutable'; END IF;
 IF OLD.responded_at IS NOT NULL AND NEW.responded_at IS DISTINCT FROM OLD.responded_at THEN RAISE EXCEPTION 'reconfirmation_response_immutable'; END IF;
 IF NEW.state IN ('confirmed','cannot_fulfill') AND NEW.responded_at IS NULL THEN RAISE EXCEPTION 'reconfirmation_response_timestamp_required'; END IF;
 IF NOT ((OLD.state='pending' AND NEW.state IN ('confirmed','cannot_fulfill','revoked')) OR (OLD.state IN ('confirmed','cannot_fulfill') AND NEW.state='revoked') OR NEW IS NOT DISTINCT FROM OLD) THEN RAISE EXCEPTION 'reconfirmation_response_immutable'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS phase3a_guard_reconfirmation ON public.phase3a_reconfirmations;
CREATE TRIGGER phase3a_guard_reconfirmation BEFORE UPDATE ON public.phase3a_reconfirmations FOR EACH ROW EXECUTE FUNCTION public.phase3a_guard_reconfirmation();
CREATE OR REPLACE FUNCTION public.phase3a_audit_reconfirmation() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO public.phase3a_lifecycle_actions(offer_id,reconfirmation_id,kind,occurred_at) VALUES(NEW.offer_id,NEW.id,'reconfirmation_request',NEW.requested_at);
 ELSIF OLD.state='pending' AND NEW.state IN ('confirmed','cannot_fulfill') THEN
  INSERT INTO public.phase3a_lifecycle_actions(offer_id,reconfirmation_id,kind,occurred_at,details,dispatch_state)
   VALUES(NEW.offer_id,NEW.id,'reconfirmation_response',NEW.responded_at,jsonb_build_object('response',NEW.state,'actorId',current_setting('cleannami.assignment_actor',true)),CASE WHEN NEW.state='cannot_fulfill' THEN 'pending' ELSE 'skipped' END);
  UPDATE public.phase3a_lifecycle_actions SET dispatch_state='skipped' WHERE reconfirmation_id=NEW.id AND dispatch_state='pending' AND kind IN ('reconfirmation_request','reconfirmation_reminder','reconfirmation_escalation');
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS phase3a_audit_reconfirmation ON public.phase3a_reconfirmations;
CREATE TRIGGER phase3a_audit_reconfirmation AFTER INSERT OR UPDATE ON public.phase3a_reconfirmations FOR EACH ROW EXECUTE FUNCTION public.phase3a_audit_reconfirmation();

CREATE OR REPLACE FUNCTION public.phase3a_guard_lifecycle_history() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM public.phase3a_assignment_offers WHERE id=OLD.offer_id) THEN RAISE EXCEPTION 'lifecycle_history_is_append_only'; END IF;
  RETURN OLD;
 END IF;
 IF NEW.id<>OLD.id OR NEW.offer_id<>OLD.offer_id OR NEW.kind<>OLD.kind OR NEW.reconfirmation_id IS DISTINCT FROM OLD.reconfirmation_id OR NEW.occurred_at<>OLD.occurred_at OR NEW.details IS DISTINCT FROM OLD.details THEN RAISE EXCEPTION 'lifecycle_history_is_append_only'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS phase3a_guard_lifecycle_history ON public.phase3a_lifecycle_actions;
CREATE TRIGGER phase3a_guard_lifecycle_history BEFORE UPDATE OR DELETE ON public.phase3a_lifecycle_actions FOR EACH ROW EXECUTE FUNCTION public.phase3a_guard_lifecycle_history();

-- Expiry retains a working reservation. A later schedule revision must give that
-- person a new, gated offer even though the old expired offer is already terminal.
CREATE OR REPLACE FUNCTION public.phase3a_reissue_reserved_workers() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.status::text NOT IN ('assigned','unassigned') OR (NEW.check_in_time IS NOT DISTINCT FROM OLD.check_in_time AND NEW.check_out_time IS NOT DISTINCT FROM OLD.check_out_time AND NEW.expected_hours IS NOT DISTINCT FROM OLD.expected_hours) THEN RETURN NEW; END IF;
 INSERT INTO public.phase3a_assignment_offers(job_id,cleaner_id,role,schedule_version)
  SELECT x.job_id,x.cleaner_id,x.role::text,j.schedule_version FROM public.jobs_to_cleaners x JOIN public.phase3a_offer_jobs j ON j.job_id=x.job_id
  WHERE x.job_id=NEW.id AND j.lifecycle_enabled AND x.role::text IN ('primary','laundry_lead')
   AND NOT EXISTS(SELECT 1 FROM public.phase3a_assignment_offers o WHERE o.job_id=x.job_id AND o.cleaner_id=x.cleaner_id AND o.schedule_version=j.schedule_version AND o.state IN ('pending','accepted','declined'));
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS phase3a_reissue_reserved_workers ON public.jobs;
CREATE TRIGGER phase3a_reissue_reserved_workers AFTER UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.phase3a_reissue_reserved_workers();
REVOKE ALL ON FUNCTION public.phase3a_stamp_response_deadline(),public.phase3a_guard_response_deadline(),public.phase3a_queue_offer_lifecycle(),public.phase3a_guard_reconfirmation(),public.phase3a_audit_reconfirmation(),public.phase3a_guard_lifecycle_history(),public.phase3a_reissue_reserved_workers() FROM PUBLIC,anon,authenticated;
COMMIT;
