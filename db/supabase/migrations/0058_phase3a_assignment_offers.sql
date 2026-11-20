-- REVIEW/HANDOFF ONLY. Owner applies after 0057 and isolated TEST acceptance.
-- No backfill or automatic enrollment. Legacy assignments/money remain untouched.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='phase2c_assignment_guard' AND NOT tgisinternal AND tgenabled<>'D')
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='residential_v2_payout_receipt' AND NOT tgisinternal AND tgenabled<>'D') THEN RAISE EXCEPTION '0050 and 0057 guards must be installed before 0058'; END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.phase3a_offer_jobs (
 job_id uuid PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
 schedule_version integer NOT NULL DEFAULT 1 CHECK(schedule_version>0),
 change_version integer NOT NULL DEFAULT 1,
 needs_dispatch boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.phase3a_assignment_offers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 version integer GENERATED ALWAYS AS IDENTITY UNIQUE,
 job_id uuid NOT NULL REFERENCES public.phase3a_offer_jobs(job_id) ON DELETE CASCADE,
 cleaner_id uuid NOT NULL REFERENCES public.cleaners(id),
 role text NOT NULL CHECK(role IN ('primary','laundry_lead','backup')),
 paired_worker_id uuid REFERENCES public.cleaners(id),
 replaces_cleaner_id uuid REFERENCES public.cleaners(id),
 swap_request_id uuid REFERENCES public.swap_requests(id),
 schedule_version integer NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted','declined','revoked')),
 offered_at timestamptz NOT NULL DEFAULT now(), responded_at timestamptz, revoked_at timestamptz,
 reason text,
 -- Durable dispatch claim: an interrupted/unknown dispatch is never automatically replayed.
 dispatch_state text NOT NULL DEFAULT 'pending' CHECK(dispatch_state IN ('pending','claimed','sent','failed')),
 dispatch_at timestamptz,
 CHECK ((role='backup') = (paired_worker_id IS NOT NULL)),
 CHECK (paired_worker_id IS DISTINCT FROM cleaner_id),
 CHECK (replaces_cleaner_id IS DISTINCT FROM cleaner_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS phase3a_offer_current_cleaner ON public.phase3a_assignment_offers(job_id,cleaner_id) WHERE state IN ('pending','accepted');
CREATE UNIQUE INDEX IF NOT EXISTS phase3a_offer_current_pair ON public.phase3a_assignment_offers(job_id,paired_worker_id) WHERE role='backup' AND state IN ('pending','accepted');
CREATE INDEX IF NOT EXISTS phase3a_offer_dispatch ON public.phase3a_assignment_offers(offered_at) WHERE state='pending' AND dispatch_state='pending';
CREATE INDEX IF NOT EXISTS phase3a_offer_job_history ON public.phase3a_assignment_offers(job_id,version);
CREATE TABLE IF NOT EXISTS public.phase3a_offer_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 offer_id uuid NOT NULL REFERENCES public.phase3a_assignment_offers(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('offered','accepted','declined','revoked','membership_removed')),
 actor_id text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(), reason text,
 assignment_terms jsonb
);
CREATE TABLE IF NOT EXISTS public.phase3a_coverage_alerts (
 job_id uuid NOT NULL REFERENCES public.phase3a_offer_jobs(job_id) ON DELETE CASCADE,
 identity text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(job_id,identity)
);
CREATE INDEX IF NOT EXISTS phase3a_offer_event_history ON public.phase3a_offer_events(offer_id,id);
ALTER TABLE public.phase3a_offer_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phase3a_assignment_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phase3a_offer_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phase3a_coverage_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.phase3a_offer_jobs,public.phase3a_assignment_offers,public.phase3a_offer_events,public.phase3a_coverage_alerts FROM PUBLIC,anon,authenticated;

-- All transitions use job -> property -> sorted cleaner/day locks, as in 0050.
-- Standby cannot be shared across jobs until capacity policy is decided.
CREATE OR REPLACE FUNCTION public.phase3a_assert_candidate(jid uuid,cid uuid,worker uuid,assigned_role text) RETURNS void
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE j public.jobs%ROWTYPE; c public.cleaners%ROWTYPE; d date; hot boolean; laundry boolean;
BEGIN
 SELECT * INTO j FROM public.jobs WHERE id=jid FOR UPDATE;
 SELECT * INTO c FROM public.cleaners WHERE id=cid FOR SHARE;
 IF j.id IS NULL OR c.id IS NULL OR j.check_in_time IS NULL OR j.status::text NOT IN ('assigned','unassigned')
  OR EXISTS(SELECT 1 FROM public.evidence_packets WHERE job_id=jid AND gps_check_in_timestamp IS NOT NULL)
 THEN RAISE EXCEPTION 'offer_job_not_assignable'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('property:'||j.property_id::text,0));
 d=(j.check_in_time AT TIME ZONE 'America/New_York')::date;
 PERFORM pg_advisory_xact_lock(hashtextextended('cleaner:'||cid::text||':'||d::text,0));
 IF NOT c.eligible_for_assignments OR c.account_status::text<>'active' OR COALESCE(c.reliability_score,100)<80 THEN RAISE EXCEPTION 'offer_cleaner_ineligible'; END IF;
 IF EXISTS(SELECT 1 FROM public.phase2c_property_exclusions WHERE property_id=j.property_id AND cleaner_id=cid) THEN RAISE EXCEPTION 'do_not_assign'; END IF;
 IF j.service_type='residential_one_time' AND (NOT c.residential_qualified OR (COALESCE((j.addons_snapshot->>'petsAllowed')::boolean,false) AND NOT c.pet_comfortable)) THEN RAISE EXCEPTION 'residential_capability'; END IF;
 IF EXISTS(SELECT 1 FROM public.phase2c_availability_days WHERE cleaner_id=cid AND date=d) THEN
  IF NOT EXISTS(SELECT 1 FROM public.phase2c_availability_days WHERE cleaner_id=cid AND date=d AND is_available) THEN RAISE EXCEPTION 'unavailable'; END IF;
 ELSIF NOT EXISTS(SELECT 1 FROM public.availability WHERE cleaner_id=cid AND date=d)
  OR NOT EXISTS(SELECT 1 FROM public.cleaner_availability_submissions WHERE cleaner_id=cid AND period_start<=d AND period_end>=d) THEN RAISE EXCEPTION 'no_acknowledged_coverage'; END IF;
 IF EXISTS(SELECT 1 FROM public.property_cleaners WHERE property_id=j.property_id AND cleaner_id=cid AND tier::text='on_call') THEN
  IF NOT COALESCE((SELECT on_call_eligible FROM public.phase2c_availability_days WHERE cleaner_id=cid AND date=d),(SELECT on_call_eligible FROM public.availability WHERE cleaner_id=cid AND date=d),false) THEN RAISE EXCEPTION 'not_opted_into_on_call'; END IF;
 ELSIF j.service_type<>'residential_one_time' AND NOT EXISTS(SELECT 1 FROM public.property_cleaners WHERE property_id=j.property_id AND cleaner_id=cid) THEN
  IF NOT COALESCE((SELECT on_call_eligible OR open_pool_eligible FROM public.phase2c_availability_days WHERE cleaner_id=cid AND date=d),(SELECT on_call_eligible OR open_pool_eligible FROM public.availability WHERE cleaner_id=cid AND date=d),false) THEN RAISE EXCEPTION 'not_opted_into_fallback_pool'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.jobs_to_cleaners x JOIN public.jobs other ON other.id=x.job_id
  WHERE x.cleaner_id=cid AND x.job_id<>jid AND x.role::text IN ('primary','laundry_lead') AND other.status::text<>'canceled'
  AND ((other.check_in_time AT TIME ZONE 'America/New_York')::date=d OR
   (other.check_in_time<CASE WHEN j.service_type='residential_one_time' THEN GREATEST(j.check_out_time,j.check_in_time+COALESCE(j.expected_hours,4)*interval '1 hour') ELSE j.check_in_time+COALESCE(j.expected_hours,4)*interval '1 hour' END
    AND CASE WHEN other.service_type='residential_one_time' THEN GREATEST(other.check_out_time,other.check_in_time+COALESCE(other.expected_hours,4)*interval '1 hour') ELSE other.check_in_time+COALESCE(other.expected_hours,4)*interval '1 hour' END>j.check_in_time)))
  OR EXISTS(SELECT 1 FROM public.phase3a_assignment_offers o JOIN public.jobs other ON other.id=o.job_id WHERE o.cleaner_id=cid AND o.job_id<>jid AND o.state IN ('pending','accepted') AND other.status::text<>'canceled' AND ((other.check_in_time AT TIME ZONE 'America/New_York')::date=d OR (other.check_in_time<CASE WHEN j.service_type='residential_one_time' THEN GREATEST(j.check_out_time,j.check_in_time+COALESCE(j.expected_hours,4)*interval '1 hour') ELSE j.check_in_time+COALESCE(j.expected_hours,4)*interval '1 hour' END AND CASE WHEN other.service_type='residential_one_time' THEN GREATEST(other.check_out_time,other.check_in_time+COALESCE(other.expected_hours,4)*interval '1 hour') ELSE other.check_in_time+COALESCE(other.expected_hours,4)*interval '1 hour' END>j.check_in_time)))
 THEN RAISE EXCEPTION 'offer_schedule_conflict'; END IF;
 IF assigned_role='laundry_lead' AND NOT c.has_laundry_lead_cert THEN RAISE EXCEPTION 'laundry_lead_not_qualified'; END IF;
 IF worker IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.jobs_to_cleaners WHERE job_id=jid AND cleaner_id=worker AND role::text IN ('primary','laundry_lead')) THEN RAISE EXCEPTION 'paired_worker_missing'; END IF;
  IF EXISTS(SELECT 1 FROM public.jobs_to_cleaners WHERE job_id=jid AND cleaner_id=worker AND role::text='laundry_lead') AND NOT c.has_laundry_lead_cert THEN RAISE EXCEPTION 'backup_laundry_lead_not_qualified'; END IF;
  IF (COALESCE(j.addons_snapshot->>'hotTubServiceLevel','none')<>'none' OR COALESCE((j.checklist_snapshot->'capabilityRequirements'->>'hotTub')::boolean,false))
   AND EXISTS(SELECT 1 FROM public.cleaners WHERE id=worker AND has_hot_tub_cert) AND NOT COALESCE(c.has_hot_tub_cert,false) THEN RAISE EXCEPTION 'paired_backup_hot_tub_not_qualified'; END IF;
  SELECT bool_or(p.has_hot_tub_cert),bool_or((x.role::text='laundry_lead' OR x.cleaner_id=worker) AND p.has_laundry_lead_cert)
   INTO hot,laundry FROM public.jobs_to_cleaners x JOIN public.cleaners p ON p.id=CASE WHEN x.cleaner_id=worker THEN cid ELSE x.cleaner_id END
   WHERE x.job_id=jid AND x.role::text IN ('primary','laundry_lead');
  IF (COALESCE(j.addons_snapshot->>'hotTubServiceLevel','none')<>'none' OR COALESCE((j.checklist_snapshot->'capabilityRequirements'->>'hotTub')::boolean,false)) AND NOT COALESCE(hot,false) THEN RAISE EXCEPTION 'backup_missing_hot_tub_capability'; END IF;
  IF (j.addons_snapshot->>'laundryType'='off_site' OR COALESCE((j.checklist_snapshot->'capabilityRequirements'->>'laundryLead')::boolean,false)) AND NOT COALESCE(laundry,false) THEN RAISE EXCEPTION 'backup_missing_laundry_lead'; END IF;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.phase3a_offer_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.version<>OLD.version OR NEW.job_id<>OLD.job_id OR NEW.cleaner_id<>OLD.cleaner_id OR NEW.role<>OLD.role
  OR NEW.paired_worker_id IS DISTINCT FROM OLD.paired_worker_id OR NEW.replaces_cleaner_id IS DISTINCT FROM OLD.replaces_cleaner_id
  OR NEW.swap_request_id IS DISTINCT FROM OLD.swap_request_id
  OR NEW.schedule_version<>OLD.schedule_version OR NEW.offered_at<>OLD.offered_at) THEN RAISE EXCEPTION 'offer_identity_immutable'; END IF;
 IF TG_OP='UPDATE' AND NEW.state IS DISTINCT FROM OLD.state AND NOT ((OLD.state='pending' AND NEW.state IN ('accepted','declined','revoked')) OR (OLD.state IN ('accepted','declined') AND NEW.state='revoked')) THEN RAISE EXCEPTION 'offer_response_immutable'; END IF;
 IF TG_OP='INSERT' OR NEW.state IS DISTINCT FROM OLD.state THEN
  UPDATE public.phase3a_offer_jobs SET change_version=change_version+1,needs_dispatch=true WHERE job_id=NEW.job_id;
  INSERT INTO public.phase3a_offer_events(offer_id,kind,actor_id,reason,assignment_terms) VALUES(NEW.id,CASE WHEN TG_OP='INSERT' THEN 'offered' ELSE NEW.state END,COALESCE(NULLIF(current_setting('cleannami.assignment_actor',true),''),'assignment-system'),NEW.reason,(SELECT to_jsonb(x) FROM public.jobs_to_cleaners x WHERE x.job_id=NEW.job_id AND x.cleaner_id=NEW.cleaner_id));
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS phase3a_offer_audit ON public.phase3a_assignment_offers;
CREATE TRIGGER phase3a_offer_audit AFTER INSERT OR UPDATE ON public.phase3a_assignment_offers FOR EACH ROW EXECUTE FUNCTION public.phase3a_offer_audit();

CREATE OR REPLACE FUNCTION public.phase3a_sync_membership() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE jid uuid; c uuid; v integer; j public.jobs%ROWTYPE;
BEGIN
 jid=CASE WHEN TG_OP='DELETE' THEN OLD.job_id ELSE NEW.job_id END;
 SELECT * INTO j FROM public.jobs WHERE id=jid FOR UPDATE;
 SELECT schedule_version INTO v FROM public.phase3a_offer_jobs WHERE job_id=jid;
 IF v IS NULL THEN RETURN NULL; END IF;
 IF TG_OP='UPDATE' AND (NEW.job_id<>OLD.job_id OR NEW.cleaner_id<>OLD.cleaner_id) THEN RAISE EXCEPTION 'offer_membership_identity_frozen'; END IF;
 IF TG_OP='UPDATE' AND NEW.job_id=OLD.job_id AND NEW.cleaner_id=OLD.cleaner_id AND NEW.role=OLD.role THEN RETURN NULL; END IF;
 UPDATE public.phase3a_offer_jobs SET change_version=change_version+1,needs_dispatch=true WHERE job_id=jid;
 IF j.status::text NOT IN ('assigned','unassigned','canceled') OR EXISTS(SELECT 1 FROM public.evidence_packets WHERE job_id=jid AND gps_check_in_timestamp IS NOT NULL) THEN RAISE EXCEPTION 'started_offer_membership_frozen'; END IF;
 IF TG_OP<>'INSERT' THEN
  INSERT INTO public.phase3a_offer_events(offer_id,kind,actor_id,reason,assignment_terms)
   SELECT id,'membership_removed',COALESCE(NULLIF(current_setting('cleannami.assignment_actor',true),''),'assignment-system'),'membership_changed',to_jsonb(OLD)
   FROM public.phase3a_assignment_offers WHERE job_id=jid AND cleaner_id=OLD.cleaner_id ORDER BY version DESC LIMIT 1;
  UPDATE public.phase3a_assignment_offers SET state='revoked',revoked_at=now(),reason='membership_changed'
   WHERE job_id=jid AND state IN ('pending','accepted','declined') AND (cleaner_id=OLD.cleaner_id OR paired_worker_id=OLD.cleaner_id)
   AND id::text IS DISTINCT FROM current_setting('cleannami.accepting_offer',true);
 END IF;
 IF TG_OP<>'DELETE' AND NEW.role::text IN ('primary','laundry_lead') THEN
  -- A direct backup promotion cannot bypass fresh working acceptance.
  IF TG_OP='UPDATE' AND OLD.role::text='backup' AND NOT EXISTS(SELECT 1 FROM public.phase3a_assignment_offers WHERE id::text=current_setting('cleannami.accepting_offer',true) AND job_id=jid AND cleaner_id=NEW.cleaner_id AND role=NEW.role::text AND state='accepted' AND schedule_version=v) THEN RAISE EXCEPTION 'working_acceptance_required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.phase3a_assignment_offers WHERE job_id=jid AND cleaner_id=NEW.cleaner_id AND role=NEW.role::text AND state='accepted' AND schedule_version=v) THEN
   INSERT INTO public.phase3a_assignment_offers(job_id,cleaner_id,role,schedule_version) VALUES(jid,NEW.cleaner_id,NEW.role::text,v);
  END IF;
 END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS phase3a_sync_membership ON public.jobs_to_cleaners;
CREATE TRIGGER phase3a_sync_membership AFTER INSERT OR UPDATE OR DELETE ON public.jobs_to_cleaners FOR EACH ROW EXECUTE FUNCTION public.phase3a_sync_membership();

CREATE OR REPLACE FUNCTION public.phase3a_sync_schedule() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE v integer; o record; cid uuid; d date;
BEGIN
 IF NEW.check_in_time IS DISTINCT FROM OLD.check_in_time OR NEW.check_out_time IS DISTINCT FROM OLD.check_out_time OR NEW.expected_hours IS DISTINCT FROM OLD.expected_hours THEN
  d=(NEW.check_in_time AT TIME ZONE 'America/New_York')::date;
  FOR cid IN SELECT cleaner_id FROM public.jobs_to_cleaners WHERE job_id=NEW.id AND role::text IN ('primary','laundry_lead') ORDER BY cleaner_id LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('cleaner:'||cid::text||':'||d::text,0));
   IF EXISTS(SELECT 1 FROM public.phase3a_assignment_offers a JOIN public.jobs other ON other.id=a.job_id WHERE a.cleaner_id=cid AND a.job_id<>NEW.id AND a.state IN ('pending','accepted') AND other.status::text<>'canceled' AND ((other.check_in_time AT TIME ZONE 'America/New_York')::date=d OR (other.check_in_time<CASE WHEN NEW.service_type='residential_one_time' THEN GREATEST(NEW.check_out_time,NEW.check_in_time+COALESCE(NEW.expected_hours,4)*interval '1 hour') ELSE NEW.check_in_time+COALESCE(NEW.expected_hours,4)*interval '1 hour' END AND CASE WHEN other.service_type='residential_one_time' THEN GREATEST(other.check_out_time,other.check_in_time+COALESCE(other.expected_hours,4)*interval '1 hour') ELSE other.check_in_time+COALESCE(other.expected_hours,4)*interval '1 hour' END>NEW.check_in_time))) THEN RAISE EXCEPTION 'reserved_offer_schedule_conflict'; END IF;
  END LOOP;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.phase3a_offer_jobs WHERE job_id=NEW.id) THEN RETURN NEW; END IF;
 IF NEW.status::text='in-progress' AND OLD.status::text<>'in-progress' AND EXISTS(
  SELECT 1 FROM public.jobs_to_cleaners x WHERE x.job_id=NEW.id AND x.role::text IN ('primary','laundry_lead') AND NOT EXISTS(SELECT 1 FROM public.phase3a_assignment_offers a WHERE a.job_id=NEW.id AND a.cleaner_id=x.cleaner_id AND a.role=x.role::text AND a.state='accepted')
 ) THEN RAISE EXCEPTION 'working_acceptance_required'; END IF;
 IF NEW.check_in_time IS NOT DISTINCT FROM OLD.check_in_time AND NEW.check_out_time IS NOT DISTINCT FROM OLD.check_out_time AND NEW.expected_hours IS NOT DISTINCT FROM OLD.expected_hours AND NEW.status::text<>'canceled' THEN RETURN NEW; END IF;
 UPDATE public.phase3a_offer_jobs SET schedule_version=schedule_version+1 WHERE job_id=NEW.id RETURNING schedule_version INTO v;
 -- Capture each identity before revoking it; every revised schedule needs a new response.
 FOR o IN SELECT * FROM public.phase3a_assignment_offers WHERE job_id=NEW.id AND state IN ('pending','accepted','declined') LOOP
  UPDATE public.phase3a_assignment_offers SET state='revoked',revoked_at=now(),reason='schedule_or_status_changed' WHERE id=o.id;
  IF NEW.status::text IN ('assigned','unassigned') AND o.replaces_cleaner_id IS NULL THEN
   INSERT INTO public.phase3a_assignment_offers(job_id,cleaner_id,role,paired_worker_id,schedule_version) VALUES(NEW.id,o.cleaner_id,o.role,o.paired_worker_id,v);
  ELSIF NEW.status::text IN ('assigned','unassigned') AND o.replaces_cleaner_id IS NOT NULL THEN
   -- An unaccepted promotion has not changed membership. Reoffer the actual standby role.
   INSERT INTO public.phase3a_assignment_offers(job_id,cleaner_id,role,paired_worker_id,schedule_version)
    SELECT NEW.id,o.cleaner_id,CASE WHEN x.role::text='backup' THEN 'backup' ELSE x.role::text END,CASE WHEN x.role::text='backup' THEN o.replaces_cleaner_id ELSE NULL END,v FROM public.jobs_to_cleaners x WHERE x.job_id=NEW.id AND x.cleaner_id=o.cleaner_id;
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS phase3a_sync_schedule ON public.jobs;
CREATE TRIGGER phase3a_sync_schedule BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.phase3a_sync_schedule();

-- A legacy/manual working insert must also respect a newly enrolled standby reservation.
CREATE OR REPLACE FUNCTION public.phase3a_guard_reservation() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE j public.jobs%ROWTYPE; d date;
BEGIN
 IF NEW.role::text NOT IN ('primary','laundry_lead') THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.job_id=OLD.job_id AND NEW.cleaner_id=OLD.cleaner_id AND NEW.role=OLD.role THEN RETURN NEW; END IF;
 SELECT * INTO j FROM public.jobs WHERE id=NEW.job_id FOR UPDATE;
 d=(j.check_in_time AT TIME ZONE 'America/New_York')::date;
 PERFORM pg_advisory_xact_lock(hashtextextended('cleaner:'||NEW.cleaner_id::text||':'||d::text,0));
 IF EXISTS(SELECT 1 FROM public.phase3a_assignment_offers o JOIN public.jobs other ON other.id=o.job_id WHERE o.cleaner_id=NEW.cleaner_id AND o.job_id<>NEW.job_id AND o.state IN ('pending','accepted') AND other.status::text<>'canceled'
  AND ((other.check_in_time AT TIME ZONE 'America/New_York')::date=d OR (other.check_in_time<CASE WHEN j.service_type='residential_one_time' THEN GREATEST(j.check_out_time,j.check_in_time+COALESCE(j.expected_hours,4)*interval '1 hour') ELSE j.check_in_time+COALESCE(j.expected_hours,4)*interval '1 hour' END AND CASE WHEN other.service_type='residential_one_time' THEN GREATEST(other.check_out_time,other.check_in_time+COALESCE(other.expected_hours,4)*interval '1 hour') ELSE other.check_in_time+COALESCE(other.expected_hours,4)*interval '1 hour' END>j.check_in_time))) THEN RAISE EXCEPTION 'reserved_offer_conflict'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS phase3a_guard_reservation ON public.jobs_to_cleaners;
CREATE TRIGGER phase3a_guard_reservation BEFORE INSERT OR UPDATE ON public.jobs_to_cleaners FOR EACH ROW EXECUTE FUNCTION public.phase3a_guard_reservation();

CREATE OR REPLACE FUNCTION public.phase3a_guard_event_history() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' OR EXISTS(SELECT 1 FROM public.phase3a_assignment_offers WHERE id=OLD.offer_id) THEN RAISE EXCEPTION 'offer_history_is_append_only'; END IF;
 RETURN OLD; -- Parent-job cascade only; no application history edit/delete.
END $$;
DROP TRIGGER IF EXISTS phase3a_guard_event_history ON public.phase3a_offer_events;
CREATE TRIGGER phase3a_guard_event_history BEFORE UPDATE OR DELETE ON public.phase3a_offer_events FOR EACH ROW EXECUTE FUNCTION public.phase3a_guard_event_history();

CREATE OR REPLACE FUNCTION public.phase3a_sync_swap() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF OLD.status::text='pending' AND NEW.status IS DISTINCT FROM OLD.status THEN
  UPDATE public.phase3a_assignment_offers SET state='revoked',revoked_at=now(),reason='swap_closed'
   WHERE swap_request_id=NEW.id AND state='pending';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS phase3a_sync_swap ON public.swap_requests;
CREATE TRIGGER phase3a_sync_swap AFTER UPDATE ON public.swap_requests FOR EACH ROW EXECUTE FUNCTION public.phase3a_sync_swap();

-- Internal tables/functions are reachable only through the authenticated server APIs.
REVOKE ALL ON FUNCTION public.phase3a_assert_candidate(uuid,uuid,uuid,text),public.phase3a_offer_audit(),public.phase3a_sync_membership(),public.phase3a_sync_schedule(),public.phase3a_guard_reservation(),public.phase3a_guard_event_history(),public.phase3a_sync_swap() FROM PUBLIC,anon,authenticated;
COMMIT;
