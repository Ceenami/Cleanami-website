-- Hand-off only. 0049 first. No production execution by an agent.
BEGIN;
CREATE OR REPLACE FUNCTION public.phase2c_guard_assignment() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
 DECLARE j public.jobs%ROWTYPE; c public.cleaners%ROWTYPE; d date; a public.phase2c_availability_days%ROWTYPE;
BEGIN
 -- Existing issued assignments are not re-underwritten by a leader/bonus edit.
 IF TG_OP='UPDATE' AND NEW.cleaner_id=OLD.cleaner_id AND NEW.job_id=OLD.job_id AND NEW.role=OLD.role THEN
  NEW.frozen_hourly_rate_cents=OLD.frozen_hourly_rate_cents; RETURN NEW;
 END IF;
 SELECT * INTO j FROM public.jobs WHERE id=NEW.job_id FOR UPDATE;
 SELECT * INTO c FROM public.cleaners WHERE id=NEW.cleaner_id FOR SHARE;
 PERFORM pg_advisory_xact_lock(hashtextextended('property:'||j.property_id::text,0));
 IF j.id IS NULL OR c.id IS NULL OR NOT c.eligible_for_assignments OR c.account_status::text<>'active' THEN RAISE EXCEPTION 'inactive_or_ineligible'; END IF;
 IF EXISTS(SELECT 1 FROM public.phase2c_property_exclusions WHERE property_id=j.property_id AND cleaner_id=c.id) THEN RAISE EXCEPTION 'do_not_assign'; END IF;
 IF j.service_type='residential_one_time' AND (NOT c.residential_qualified OR (COALESCE((j.addons_snapshot->>'petsAllowed')::boolean,false) AND NOT c.pet_comfortable)) THEN RAISE EXCEPTION 'residential_capability'; END IF;
 IF j.status::text NOT IN ('assigned','unassigned') THEN RAISE EXCEPTION 'job_not_assignable'; END IF;
 IF current_setting('cleannami.assignment_source',true)='automatic' AND COALESCE(c.reliability_score,100)<80 THEN RAISE EXCEPTION 'reliability_below_80'; END IF;
 IF NEW.role::text NOT IN ('primary','laundry_lead') THEN RETURN NEW; END IF;
 IF j.status::text IN ('completed','canceled','awaiting_capture','completed_pending_evidence') THEN RAISE EXCEPTION 'job_not_assignable'; END IF;
 IF j.check_in_time IS NULL THEN RAISE EXCEPTION 'missing_arrival'; END IF;
 d=(j.check_in_time AT TIME ZONE 'America/New_York')::date;
 PERFORM pg_advisory_xact_lock(hashtextextended('cleaner:'||c.id::text||':'||d::text,0));
 SELECT * INTO a FROM public.phase2c_availability_days WHERE cleaner_id=c.id AND date=d;
 IF a.cleaner_id IS NOT NULL THEN
  IF NOT a.is_available THEN RAISE EXCEPTION 'unavailable'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.cleaner_availability_submissions WHERE cleaner_id=c.id AND period_start<=d AND period_end>=d)
   OR NOT EXISTS(SELECT 1 FROM public.availability WHERE cleaner_id=c.id AND date=d) THEN RAISE EXCEPTION 'no_acknowledged_coverage'; END IF;
 END IF;
 IF current_setting('cleannami.assignment_source',true)='automatic' AND (
  EXISTS(SELECT 1 FROM public.property_cleaners WHERE property_id=j.property_id AND cleaner_id=c.id AND tier::text='on_call')
  OR (j.service_type<>'residential_one_time' AND NOT EXISTS(SELECT 1 FROM public.property_cleaners WHERE property_id=j.property_id AND cleaner_id=c.id))
 ) THEN
  IF a.cleaner_id IS NOT NULL THEN
   IF NOT a.on_call_eligible AND NOT a.open_pool_eligible THEN RAISE EXCEPTION 'not_opted_into_fallback_pool'; END IF;
   IF EXISTS(SELECT 1 FROM public.property_cleaners WHERE property_id=j.property_id AND cleaner_id=c.id AND tier::text='on_call') AND NOT a.on_call_eligible THEN RAISE EXCEPTION 'not_opted_into_on_call'; END IF;
  ELSIF NOT EXISTS(SELECT 1 FROM public.availability WHERE cleaner_id=c.id AND date=d AND (on_call_eligible OR open_pool_eligible)) THEN RAISE EXCEPTION 'not_opted_into_fallback_pool';
  ELSIF EXISTS(SELECT 1 FROM public.property_cleaners WHERE property_id=j.property_id AND cleaner_id=c.id AND tier::text='on_call') AND NOT EXISTS(SELECT 1 FROM public.availability WHERE cleaner_id=c.id AND date=d AND on_call_eligible) THEN RAISE EXCEPTION 'not_opted_into_on_call'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.jobs_to_cleaners x JOIN public.jobs other ON other.id=x.job_id
  WHERE x.cleaner_id=c.id AND x.job_id<>j.id AND x.role::text IN ('primary','laundry_lead') AND other.status::text<>'canceled'
  AND other.check_in_time<CASE WHEN j.service_type='residential_one_time' THEN GREATEST(j.check_out_time,j.check_in_time+COALESCE(j.expected_hours,4)*interval '1 hour') ELSE j.check_in_time+COALESCE(j.expected_hours,4)*interval '1 hour' END
  AND CASE WHEN other.service_type='residential_one_time' THEN GREATEST(other.check_out_time,other.check_in_time+COALESCE(other.expected_hours,4)*interval '1 hour') ELSE other.check_in_time+COALESCE(other.expected_hours,4)*interval '1 hour' END>j.check_in_time) THEN RAISE EXCEPTION 'physical_overlap'; END IF;
 IF EXISTS(SELECT 1 FROM public.jobs_to_cleaners x JOIN public.jobs other ON other.id=x.job_id
  WHERE x.cleaner_id=c.id AND x.job_id<>j.id AND x.role::text IN ('primary','laundry_lead') AND other.status::text<>'canceled'
  AND (other.check_in_time AT TIME ZONE 'America/New_York')::date=d)
  AND COALESCE(current_setting('cleannami.same_day_override',true),'')<>'approved' THEN RAISE EXCEPTION 'same_day_conflict'; END IF;
 IF NEW.role::text='laundry_lead' AND NOT c.has_laundry_lead_cert THEN RAISE EXCEPTION 'laundry_lead_not_qualified'; END IF;
 IF j.service_type='residential_one_time' AND j.addons_snapshot ? 'residentialPricing' THEN
  NEW.frozen_hourly_rate_cents=CASE WHEN TG_OP='UPDATE' AND OLD.frozen_hourly_rate_cents IS NOT NULL THEN OLD.frozen_hourly_rate_cents ELSE COALESCE(NULLIF(c.hourly_rate_cents,0),1700) END;
 END IF;
 IF COALESCE(current_setting('cleannami.assignment_source',true),'')<>'automatic' THEN
  INSERT INTO public.phase2c_assignment_runs(job_id,outcome,candidates,reason,actor_id,context)
  VALUES(j.id,'assigned',jsonb_build_array(jsonb_build_object('cleanerId',c.id,'source',COALESCE(NULLIF(current_setting('cleannami.assignment_source',true),''),'replacement'),'reasons','[]'::jsonb,'selected',true)),NEW.role::text,NULLIF(current_setting('cleannami.assignment_actor',true),''),jsonb_build_object('scheduledAt',j.check_in_time,'teamSize',j.addons_snapshot->'teamSize','override',NULLIF(current_setting('cleannami.assignment_override',true),'')));
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS phase2c_assignment_guard ON public.jobs_to_cleaners;
CREATE TRIGGER phase2c_assignment_guard BEFORE INSERT OR UPDATE ON public.jobs_to_cleaners FOR EACH ROW EXECUTE FUNCTION public.phase2c_guard_assignment();
CREATE OR REPLACE FUNCTION public.phase2c_guard_working_team() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE jid uuid; j public.jobs%ROWTYPE; hot boolean; laundry boolean;
BEGIN
 IF TG_TABLE_NAME='jobs' THEN jid=NEW.id; ELSE jid=COALESCE(NEW.job_id,OLD.job_id); END IF;
 SELECT * INTO j FROM public.jobs WHERE id=jid;
 IF j.id IS NULL OR j.status::text<>'assigned' THEN RETURN NULL; END IF;
 IF COALESCE((j.addons_snapshot->>'requiresManualStaffing')::boolean,false) THEN RAISE EXCEPTION 'manual_staffing_required'; END IF;
 IF (SELECT count(*) FROM public.jobs_to_cleaners WHERE job_id=jid AND role::text IN ('primary','laundry_lead')) <> COALESCE((j.addons_snapshot->>'teamSize')::integer,1) THEN RAISE EXCEPTION 'working_team_size_mismatch'; END IF;
 SELECT bool_or(c.has_hot_tub_cert),bool_or(x.role::text='laundry_lead' AND c.has_laundry_lead_cert) INTO hot,laundry
 FROM public.jobs_to_cleaners x JOIN public.cleaners c ON c.id=x.cleaner_id WHERE x.job_id=jid AND x.role::text IN ('primary','laundry_lead');
 IF (COALESCE(j.addons_snapshot->>'hotTubServiceLevel','none')<>'none' OR COALESCE((j.checklist_snapshot->'capabilityRequirements'->>'hotTub')::boolean,false)) AND NOT COALESCE(hot,false) THEN RAISE EXCEPTION 'team_missing_hot_tub_capability'; END IF;
 IF (j.addons_snapshot->>'laundryType'='off_site' OR COALESCE((j.checklist_snapshot->'capabilityRequirements'->>'laundryLead')::boolean,false)) AND NOT COALESCE(laundry,false) THEN RAISE EXCEPTION 'team_missing_laundry_lead'; END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS phase2c_working_team_guard ON public.jobs_to_cleaners;
CREATE CONSTRAINT TRIGGER phase2c_working_team_guard AFTER INSERT OR UPDATE OR DELETE ON public.jobs_to_cleaners DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.phase2c_guard_working_team();
DROP TRIGGER IF EXISTS phase2c_job_team_guard ON public.jobs;
CREATE CONSTRAINT TRIGGER phase2c_job_team_guard AFTER UPDATE ON public.jobs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.phase2c_guard_working_team();
-- Moving an already staffed job is also a scheduling write, not an assignment bypass.
CREATE OR REPLACE FUNCTION public.phase2c_guard_schedule_edit() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE cid uuid; d date; a public.phase2c_availability_days%ROWTYPE;
BEGIN
 IF OLD.service_type='residential_one_time' AND (NEW.addons_snapshot IS DISTINCT FROM OLD.addons_snapshot OR NEW.expected_hours IS DISTINCT FROM OLD.expected_hours OR NEW.service_type IS DISTINCT FROM OLD.service_type) THEN RAISE EXCEPTION 'booked_residential_terms_are_frozen'; END IF;
 IF NEW.check_in_time IS NOT DISTINCT FROM OLD.check_in_time AND NEW.expected_hours IS NOT DISTINCT FROM OLD.expected_hours AND NEW.check_out_time IS NOT DISTINCT FROM OLD.check_out_time THEN RETURN NEW; END IF;
 IF OLD.status::text IN ('in-progress','completed_pending_evidence','awaiting_capture','completed') THEN RAISE EXCEPTION 'started_job_schedule_is_frozen'; END IF;
 IF NEW.check_in_time IS NULL THEN
  IF EXISTS(SELECT 1 FROM public.jobs_to_cleaners WHERE job_id=NEW.id AND role::text IN ('primary','laundry_lead')) THEN RAISE EXCEPTION 'staffed_job_requires_arrival'; END IF;
  RETURN NEW;
 END IF;
 d=(NEW.check_in_time AT TIME ZONE 'America/New_York')::date;
 PERFORM pg_advisory_xact_lock(hashtextextended('property:'||NEW.property_id::text,0));
 FOR cid IN SELECT cleaner_id FROM public.jobs_to_cleaners WHERE job_id=NEW.id AND role::text IN ('primary','laundry_lead') ORDER BY cleaner_id LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('cleaner:'||cid::text||':'||d::text,0));
  SELECT * INTO a FROM public.phase2c_availability_days WHERE cleaner_id=cid AND date=d;
  IF a.cleaner_id IS NOT NULL THEN
   IF NOT a.is_available THEN RAISE EXCEPTION 'unavailable'; END IF;
  ELSIF NOT EXISTS(SELECT 1 FROM public.cleaner_availability_submissions WHERE cleaner_id=cid AND period_start<=d AND period_end>=d) OR NOT EXISTS(SELECT 1 FROM public.availability WHERE cleaner_id=cid AND date=d) THEN RAISE EXCEPTION 'no_acknowledged_coverage'; END IF;
  IF EXISTS(SELECT 1 FROM public.jobs_to_cleaners x JOIN public.jobs other ON other.id=x.job_id WHERE x.cleaner_id=cid AND x.job_id<>NEW.id AND x.role::text IN ('primary','laundry_lead') AND other.status::text<>'canceled'
    AND other.check_in_time<CASE WHEN NEW.service_type='residential_one_time' THEN GREATEST(NEW.check_out_time,NEW.check_in_time+COALESCE(NEW.expected_hours,4)*interval '1 hour') ELSE NEW.check_in_time+COALESCE(NEW.expected_hours,4)*interval '1 hour' END
    AND CASE WHEN other.service_type='residential_one_time' THEN GREATEST(other.check_out_time,other.check_in_time+COALESCE(other.expected_hours,4)*interval '1 hour') ELSE other.check_in_time+COALESCE(other.expected_hours,4)*interval '1 hour' END>NEW.check_in_time) THEN RAISE EXCEPTION 'physical_overlap'; END IF;
  IF EXISTS(SELECT 1 FROM public.jobs_to_cleaners x JOIN public.jobs other ON other.id=x.job_id
    WHERE x.cleaner_id=cid AND x.job_id<>NEW.id AND x.role::text IN ('primary','laundry_lead') AND other.status::text<>'canceled'
    AND (other.check_in_time AT TIME ZONE 'America/New_York')::date=d)
    AND COALESCE(current_setting('cleannami.same_day_override',true),'')<>'approved' THEN RAISE EXCEPTION 'same_day_conflict'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS phase2c_schedule_edit_guard ON public.jobs;
CREATE TRIGGER phase2c_schedule_edit_guard BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.phase2c_guard_schedule_edit();
COMMIT;
