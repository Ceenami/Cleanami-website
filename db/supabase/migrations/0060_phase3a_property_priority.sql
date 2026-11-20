-- REVIEW/HANDOFF ONLY. Owner applies after 0058/0059 and isolated TEST acceptance.
-- Prospective plans only; no roster designations, backfill, pay rewrite or enrollment.
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT required.name FROM unnest(ARRAY['phase3a_offer_audit','phase3a_guard_response_deadline','phase3a_guard_reservation','phase2c_working_team_guard','phase2c_job_team_guard']) required(name)
  WHERE NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgname=required.name AND NOT t.tgisinternal AND t.tgenabled<>'D'))
 THEN RAISE EXCEPTION '0050, 0058 and 0059 active guards must be verified before 0060'; END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.phase3a_priority_plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 target_job_id uuid NOT NULL REFERENCES public.phase3a_offer_jobs(job_id),
 donor_job_id uuid NOT NULL REFERENCES public.phase3a_offer_jobs(job_id),
 cleaner_id uuid NOT NULL REFERENCES public.cleaners(id),
 donor_offer_id uuid NOT NULL REFERENCES public.phase3a_assignment_offers(id),
 replacement_offer_id uuid NOT NULL UNIQUE REFERENCES public.phase3a_assignment_offers(id),
 target_team jsonb NOT NULL CHECK(jsonb_typeof(target_team)='array'),
 target_fingerprint jsonb NOT NULL, donor_fingerprint jsonb NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','completed','failed','canceled')),
 reason text, actor_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
 CHECK(target_job_id<>donor_job_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS phase3a_priority_active_target ON public.phase3a_priority_plans(target_job_id) WHERE state='pending';
CREATE UNIQUE INDEX IF NOT EXISTS phase3a_priority_active_donor ON public.phase3a_priority_plans(donor_job_id) WHERE state='pending';
CREATE UNIQUE INDEX IF NOT EXISTS phase3a_priority_active_cleaner ON public.phase3a_priority_plans(cleaner_id) WHERE state='pending';
CREATE INDEX IF NOT EXISTS phase3a_priority_target_history ON public.phase3a_priority_plans(target_job_id,created_at);
CREATE INDEX IF NOT EXISTS phase3a_priority_donor_history ON public.phase3a_priority_plans(donor_job_id,created_at);
CREATE TABLE IF NOT EXISTS public.phase3a_priority_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, plan_id uuid NOT NULL REFERENCES public.phase3a_priority_plans(id),
 state text NOT NULL, reason text, actor_id text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.phase3a_priority_notices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plan_id uuid NOT NULL REFERENCES public.phase3a_priority_plans(id),
 state text NOT NULL, job_id uuid NOT NULL REFERENCES public.jobs(id), audience text NOT NULL,
 cleaner_id uuid REFERENCES public.cleaners(id), dispatch_state text NOT NULL DEFAULT 'pending' CHECK(dispatch_state IN ('pending','claimed','sent','failed','skipped')),
 created_at timestamptz NOT NULL DEFAULT now(), claimed_at timestamptz
);
CREATE INDEX IF NOT EXISTS phase3a_priority_event_history ON public.phase3a_priority_events(plan_id,id);
CREATE INDEX IF NOT EXISTS phase3a_priority_notice_pending ON public.phase3a_priority_notices(created_at,id) WHERE dispatch_state='pending';
CREATE INDEX IF NOT EXISTS phase3a_priority_notice_job ON public.phase3a_priority_notices(job_id) WHERE dispatch_state IN('claimed','failed');
CREATE UNIQUE INDEX IF NOT EXISTS phase3a_priority_notice_identity ON public.phase3a_priority_notices(plan_id,state,job_id,audience,coalesce(cleaner_id,'00000000-0000-0000-0000-000000000000'::uuid));
ALTER TABLE public.phase3a_priority_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phase3a_priority_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phase3a_priority_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.phase3a_priority_plans,public.phase3a_priority_events,public.phase3a_priority_notices FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.phase3a_priority_fingerprint(jid uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('property',j.property_id,'status',j.status,'start',j.check_in_time,'end',j.check_out_time,
  'hours',j.expected_hours,'service',j.service_type,'terms',j.addons_snapshot,'checklist',j.checklist_snapshot,
  'schedule',(SELECT schedule_version FROM phase3a_offer_jobs WHERE job_id=jid),
  'workers',COALESCE((SELECT jsonb_agg(jsonb_build_object('cleaner',x.cleaner_id,'role',x.role,'created',x.created_at) ORDER BY x.cleaner_id)
    FROM jobs_to_cleaners x WHERE x.job_id=jid AND x.role::text IN ('primary','laundry_lead')),'[]'::jsonb)) FROM jobs j WHERE j.id=jid
$$;
CREATE OR REPLACE FUNCTION public.phase3a_priority_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'priority_plan_history_frozen'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-'state'-'reason'-'resolved_at') IS DISTINCT FROM (to_jsonb(OLD)-'state'-'reason'-'resolved_at') THEN RAISE EXCEPTION 'priority_plan_identity_frozen'; END IF;
  IF OLD.state<>'pending' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN RAISE EXCEPTION 'priority_plan_terminal'; END IF;
  IF NEW.state=OLD.state THEN
   IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN RAISE EXCEPTION 'priority_transition_required'; END IF;
   RETURN NEW;
  END IF;
  IF NEW.resolved_at IS NULL OR (NEW.state IN ('failed','canceled') AND NULLIF(NEW.reason,'') IS NULL) THEN RAISE EXCEPTION 'priority_resolution_required'; END IF;
 END IF;
 INSERT INTO phase3a_priority_events(plan_id,state,reason,actor_id) VALUES(NEW.id,NEW.state,NEW.reason,COALESCE(NULLIF(current_setting('cleannami.assignment_actor',true),''),NEW.actor_id));
 INSERT INTO phase3a_priority_notices(plan_id,state,job_id,audience)
  SELECT NEW.id,NEW.state,jid,'admin' FROM unnest(ARRAY[NEW.target_job_id,NEW.donor_job_id]) jid ON CONFLICT DO NOTHING;
 IF NEW.state<>'pending' THEN
  INSERT INTO phase3a_priority_notices(plan_id,state,job_id,audience,cleaner_id)
   SELECT NEW.id,NEW.state,x.job_id,'cleaner',x.cleaner_id FROM jobs_to_cleaners x WHERE x.job_id IN(NEW.target_job_id,NEW.donor_job_id)
   UNION SELECT NEW.id,NEW.state,NEW.donor_job_id,'cleaner',NEW.cleaner_id
   UNION SELECT NEW.id,NEW.state,NEW.donor_job_id,'cleaner',o.cleaner_id FROM phase3a_assignment_offers o WHERE o.id=NEW.replacement_offer_id
   ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS phase3a_priority_audit ON public.phase3a_priority_plans;
CREATE TRIGGER phase3a_priority_audit AFTER INSERT OR UPDATE OR DELETE ON public.phase3a_priority_plans FOR EACH ROW EXECUTE FUNCTION public.phase3a_priority_audit();
CREATE OR REPLACE FUNCTION public.phase3a_priority_history_guard() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'priority_events_append_only'; END $$;
DROP TRIGGER IF EXISTS phase3a_priority_history_guard ON public.phase3a_priority_events;
CREATE TRIGGER phase3a_priority_history_guard BEFORE UPDATE OR DELETE ON public.phase3a_priority_events FOR EACH ROW EXECUTE FUNCTION public.phase3a_priority_history_guard();
CREATE OR REPLACE FUNCTION public.phase3a_priority_notice_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF (to_jsonb(NEW)-'dispatch_state'-'claimed_at') IS DISTINCT FROM (to_jsonb(OLD)-'dispatch_state'-'claimed_at') THEN RAISE EXCEPTION 'priority_notice_identity_frozen'; END IF;
 IF NOT ((OLD.dispatch_state='pending' AND NEW.dispatch_state='claimed' AND NEW.claimed_at IS NOT NULL)
  OR (OLD.dispatch_state='claimed' AND NEW.dispatch_state IN ('sent','failed','skipped') AND NEW.claimed_at IS NOT DISTINCT FROM OLD.claimed_at)
  OR to_jsonb(NEW) IS NOT DISTINCT FROM to_jsonb(OLD)) THEN RAISE EXCEPTION 'priority_notice_no_replay'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS phase3a_priority_notice_guard ON public.phase3a_priority_notices;
CREATE TRIGGER phase3a_priority_notice_guard BEFORE UPDATE ON public.phase3a_priority_notices FOR EACH ROW EXECUTE FUNCTION public.phase3a_priority_notice_guard();

-- Preview only: the sole ignored conflict is a verified priority cleaner's current donor job.
-- Actual membership writes still use every unchanged 0050/0058 guard, without an exception.
CREATE OR REPLACE FUNCTION public.phase3a_assert_priority_candidate(jid uuid,cid uuid,worker uuid,assigned_role text,ignored_job uuid) RETURNS void
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE j public.jobs%ROWTYPE; c public.cleaners%ROWTYPE; d date; hot boolean; laundry boolean;
BEGIN
 SELECT * INTO j FROM public.jobs WHERE id=jid FOR UPDATE;
 SELECT * INTO c FROM public.cleaners WHERE id=cid FOR SHARE;
 IF j.id IS NULL OR c.id IS NULL OR j.check_in_time IS NULL OR j.status::text NOT IN ('assigned','unassigned')
  OR EXISTS(SELECT 1 FROM public.evidence_packets WHERE job_id=jid AND gps_check_in_timestamp IS NOT NULL)
 THEN RAISE EXCEPTION 'offer_job_not_assignable'; END IF;
 IF ignored_job IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.property_cleaners WHERE property_id=j.property_id AND cleaner_id=cid AND tier::text='main_primary')
   OR (SELECT count(*) FROM public.property_cleaners WHERE cleaner_id=cid AND tier::text='main_primary')<>1
   OR NOT EXISTS(SELECT 1 FROM public.jobs donor JOIN public.jobs_to_cleaners x ON x.job_id=donor.id WHERE donor.id=ignored_job AND donor.property_id<>j.property_id AND x.cleaner_id=cid AND x.role::text IN ('primary','laundry_lead') AND donor.status::text='assigned' AND donor.check_in_time>clock_timestamp())
   OR EXISTS(SELECT 1 FROM public.evidence_packets WHERE job_id=ignored_job AND gps_check_in_timestamp IS NOT NULL)
  THEN RAISE EXCEPTION 'priority_designation_or_donor_changed'; END IF;
 END IF;
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
  WHERE x.cleaner_id=cid AND x.job_id<>jid AND x.job_id IS DISTINCT FROM ignored_job AND x.role::text IN ('primary','laundry_lead') AND other.status::text<>'canceled'
  AND ((other.check_in_time AT TIME ZONE 'America/New_York')::date=d OR
   (other.check_in_time<CASE WHEN j.service_type='residential_one_time' THEN GREATEST(j.check_out_time,j.check_in_time+COALESCE(j.expected_hours,4)*interval '1 hour') ELSE j.check_in_time+COALESCE(j.expected_hours,4)*interval '1 hour' END
    AND CASE WHEN other.service_type='residential_one_time' THEN GREATEST(other.check_out_time,other.check_in_time+COALESCE(other.expected_hours,4)*interval '1 hour') ELSE other.check_in_time+COALESCE(other.expected_hours,4)*interval '1 hour' END>j.check_in_time)))
  OR EXISTS(SELECT 1 FROM public.phase3a_assignment_offers o JOIN public.jobs other ON other.id=o.job_id WHERE o.cleaner_id=cid AND o.job_id<>jid AND o.job_id IS DISTINCT FROM ignored_job AND o.state IN ('pending','accepted') AND other.status::text<>'canceled' AND ((other.check_in_time AT TIME ZONE 'America/New_York')::date=d OR (other.check_in_time<CASE WHEN j.service_type='residential_one_time' THEN GREATEST(j.check_out_time,j.check_in_time+COALESCE(j.expected_hours,4)*interval '1 hour') ELSE j.check_in_time+COALESCE(j.expected_hours,4)*interval '1 hour' END AND CASE WHEN other.service_type='residential_one_time' THEN GREATEST(other.check_out_time,other.check_in_time+COALESCE(other.expected_hours,4)*interval '1 hour') ELSE other.check_in_time+COALESCE(other.expected_hours,4)*interval '1 hour' END>j.check_in_time)))
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
-- The legacy one-job responder must not bypass the cross-job coordinator.
CREATE OR REPLACE FUNCTION public.phase3a_priority_accept_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.state='accepted' AND OLD.state<>'accepted' AND EXISTS(
  SELECT 1 FROM phase3a_priority_plans p WHERE p.replacement_offer_id=NEW.id
   AND (p.state<>'pending' OR p.id::text IS DISTINCT FROM current_setting('cleannami.accepting_priority_plan',true)))
 THEN RAISE EXCEPTION 'priority_coordinator_required'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS phase3a_priority_accept_guard ON public.phase3a_assignment_offers;
CREATE TRIGGER phase3a_priority_accept_guard BEFORE UPDATE ON public.phase3a_assignment_offers FOR EACH ROW EXECUTE FUNCTION public.phase3a_priority_accept_guard();
REVOKE ALL ON FUNCTION public.phase3a_priority_fingerprint(uuid),public.phase3a_priority_audit(),public.phase3a_priority_history_guard(),public.phase3a_priority_notice_guard(),public.phase3a_assert_priority_candidate(uuid,uuid,uuid,text,uuid),public.phase3a_priority_accept_guard() FROM PUBLIC,anon,authenticated;
COMMIT;
