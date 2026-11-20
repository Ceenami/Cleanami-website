-- Owner review/apply only after 0058/0059/0060. No historical enrollment,
-- deadline rewrite, membership/pay change, provider call or production activation.
BEGIN;
ALTER TABLE public.phase3a_offer_jobs ADD COLUMN IF NOT EXISTS automation_policy text
 CHECK(automation_policy IS NULL OR automation_policy='phase3a-complete-2026-11-13');

CREATE OR REPLACE FUNCTION public.phase3a_stamp_response_deadline() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE start_at timestamptz; lead interval; window_size interval; policy text;
BEGIN
 NEW.response_due_at=NULL; NEW.response_reminder_at=NULL; NEW.deadline_gate=NULL;
 SELECT automation_policy INTO policy FROM public.phase3a_offer_jobs WHERE job_id=NEW.job_id AND lifecycle_enabled;
 IF NOT FOUND THEN RETURN NEW; END IF;
 SELECT check_in_time INTO start_at FROM public.jobs WHERE id=NEW.job_id;
 lead=start_at-NEW.offered_at;
 IF policy='phase3a-complete-2026-11-13' THEN
  IF start_at IS NULL THEN NEW.deadline_gate='missing_schedule'; RETURN NEW; END IF;
  window_size=greatest(interval '0',least(lead,CASE WHEN lead>interval '72 hours' THEN interval '12 hours' WHEN lead>=interval '24 hours' THEN interval '2 hours' ELSE interval '30 minutes' END));
  NEW.response_due_at=NEW.offered_at+window_size;
  NEW.response_reminder_at=NEW.offered_at+window_size/2;
 ELSIF NEW.role='backup' THEN NEW.deadline_gate='backup_deadline_policy';
 ELSIF NEW.replaces_cleaner_id IS NOT NULL THEN NEW.deadline_gate='promotion_deadline_policy';
 ELSIF NEW.schedule_version>1 THEN NEW.deadline_gate='rescheduled_deadline_policy';
 ELSIF start_at IS NULL OR lead<interval '30 minutes' THEN NEW.deadline_gate='near_start_deadline_policy';
 ELSE
  window_size=CASE WHEN lead>interval '72 hours' THEN interval '12 hours' WHEN lead>=interval '24 hours' THEN interval '2 hours' ELSE interval '30 minutes' END;
  NEW.response_due_at=NEW.offered_at+window_size; NEW.response_reminder_at=NEW.offered_at+window_size/2;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.phase3a_stamp_response_deadline() FROM PUBLIC,anon,authenticated;

-- An already staffed target keeps its incumbent until the incoming main cleaner
-- AND the donor replacement have explicitly confirmed the proposed duties.
CREATE TABLE IF NOT EXISTS public.phase3a_priority_move_approvals (
 plan_id uuid PRIMARY KEY REFERENCES public.phase3a_priority_plans(id),
 cleaner_id uuid NOT NULL REFERENCES public.cleaners(id), target_schedule_version integer NOT NULL,
 details jsonb NOT NULL, offered_at timestamptz NOT NULL DEFAULT now(),
 response_due_at timestamptz NOT NULL, reminder_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','accepted','declined','revoked')),
 responded_at timestamptz, reason text,
 CHECK(response_due_at>=offered_at AND reminder_at>=offered_at AND reminder_at<=response_due_at)
);
CREATE INDEX IF NOT EXISTS phase3a_priority_approval_cleaner ON public.phase3a_priority_move_approvals(cleaner_id,offered_at);
ALTER TABLE public.phase3a_priority_move_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.phase3a_priority_move_approvals FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.phase3a_guard_priority_approval() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'priority_approval_history_frozen'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'pending' OR NEW.responded_at IS NOT NULL OR jsonb_typeof(NEW.details)<>'object'
    OR NOT (NEW.details ?& ARRAY['address','plannedStart','plannedEnd','role','expectedHours','rateCents'])
    OR NEW.details->>'role' NOT IN('primary','laundry_lead')
  THEN RAISE EXCEPTION 'priority_approval_must_start_pending'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.phase3a_priority_plans p JOIN public.phase3a_offer_jobs j ON j.job_id=p.target_job_id
    WHERE p.id=NEW.plan_id AND p.cleaner_id=NEW.cleaner_id AND p.state='pending' AND j.schedule_version=NEW.target_schedule_version
      AND j.automation_policy='phase3a-complete-2026-11-13') THEN RAISE EXCEPTION 'priority_approval_plan_changed'; END IF;
 ELSE
  IF (to_jsonb(NEW)-'state'-'responded_at'-'reason') IS DISTINCT FROM (to_jsonb(OLD)-'state'-'responded_at'-'reason')
   OR (OLD.responded_at IS NOT NULL AND NEW.responded_at IS DISTINCT FROM OLD.responded_at)
   OR NOT ((OLD.state='pending' AND NEW.state IN('accepted','declined','revoked')) OR (OLD.state='accepted' AND NEW.state='revoked') OR NEW IS NOT DISTINCT FROM OLD)
   OR (OLD.state='pending' AND NEW.state IN('accepted','declined') AND (NEW.responded_at IS NULL OR clock_timestamp()>=OLD.response_due_at))
  THEN RAISE EXCEPTION 'priority_approval_identity_or_response_frozen'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS phase3a_guard_priority_approval ON public.phase3a_priority_move_approvals;
CREATE TRIGGER phase3a_guard_priority_approval BEFORE INSERT OR UPDATE OR DELETE ON public.phase3a_priority_move_approvals FOR EACH ROW EXECUTE FUNCTION public.phase3a_guard_priority_approval();
REVOKE ALL ON FUNCTION public.phase3a_guard_priority_approval() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.phase3a_guard_automation_policy() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.automation_policy IS NOT NULL AND NEW.automation_policy IS DISTINCT FROM OLD.automation_policy THEN RAISE EXCEPTION 'assignment_automation_policy_frozen'; END IF;
 IF NEW.automation_policy IS NOT NULL AND (TG_OP='INSERT' OR OLD.automation_policy IS NULL) THEN
  IF NOT NEW.lifecycle_enabled OR NOT EXISTS(SELECT 1 FROM public.jobs j WHERE j.id=NEW.job_id AND j.status::text IN('unassigned','assigned') AND j.check_in_time>clock_timestamp()
    AND NOT EXISTS(SELECT 1 FROM public.evidence_packets e WHERE e.job_id=j.id AND e.gps_check_in_timestamp IS NOT NULL)) THEN RAISE EXCEPTION 'automation_enrollment_requires_future_unstarted_job'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS phase3a_guard_automation_policy ON public.phase3a_offer_jobs;
CREATE TRIGGER phase3a_guard_automation_policy BEFORE INSERT OR UPDATE ON public.phase3a_offer_jobs FOR EACH ROW EXECUTE FUNCTION public.phase3a_guard_automation_policy();
REVOKE ALL ON FUNCTION public.phase3a_guard_automation_policy() FROM PUBLIC,anon,authenticated;

-- Pin the existing hourly policy on newly issued working memberships only.
-- Existing legacy/null rates and all same-role edits remain historical terms.
CREATE OR REPLACE FUNCTION public.phase3a_freeze_working_rate() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.role::text IN('primary','laundry_lead') THEN
  NEW.frozen_hourly_rate_cents=OLD.frozen_hourly_rate_cents; RETURN NEW;
 END IF;
 IF NEW.role::text IN('primary','laundry_lead') AND EXISTS(SELECT 1 FROM public.phase3a_offer_jobs WHERE job_id=NEW.job_id AND automation_policy='phase3a-complete-2026-11-13') THEN
  IF (SELECT addons_snapshot->'residentialPricing'->>'ruleVersion' FROM public.jobs WHERE id=NEW.job_id)='residential-v2' THEN NEW.frozen_hourly_rate_cents=1900;
  ELSE SELECT coalesce(nullif(hourly_rate_cents,0),1700) INTO NEW.frozen_hourly_rate_cents FROM public.cleaners WHERE id=NEW.cleaner_id; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS phase3a_freeze_working_rate ON public.jobs_to_cleaners;
CREATE TRIGGER phase3a_freeze_working_rate BEFORE INSERT OR UPDATE ON public.jobs_to_cleaners FOR EACH ROW EXECUTE FUNCTION public.phase3a_freeze_working_rate();
REVOKE ALL ON FUNCTION public.phase3a_freeze_working_rate() FROM PUBLIC,anon,authenticated;

-- Change only the former blanket multi-main gate; actual writes continue to
-- use all ordinary candidate/reservation guards with no ignored conflicts.
-- Preserve an incumbent main-property assignment when both properties are main.
DO $$
DECLARE definition text;
 old_gate text := 'OR (SELECT count(*) FROM public.property_cleaners WHERE cleaner_id=cid AND tier::text=''main_primary'')<>1';
 new_gate text := 'OR ((SELECT count(*) FROM public.property_cleaners WHERE cleaner_id=cid AND tier::text=''main_primary'')<>1 AND NOT EXISTS(SELECT 1 FROM public.phase3a_offer_jobs WHERE job_id=jid AND automation_policy=''phase3a-complete-2026-11-13'')) OR EXISTS(SELECT 1 FROM public.property_cleaners r JOIN public.jobs incumbent ON incumbent.property_id=r.property_id WHERE incumbent.id=ignored_job AND r.cleaner_id=cid AND r.tier::text=''main_primary'')';
BEGIN
 SELECT pg_get_functiondef('public.phase3a_assert_priority_candidate(uuid,uuid,uuid,text,uuid)'::regprocedure) INTO definition;
 IF position(old_gate in definition)=0 AND position(new_gate in definition)=0 THEN RAISE EXCEPTION 'priority_candidate_catalog_changed_review_before_migration'; END IF;
 definition=replace(definition,old_gate,new_gate);
 EXECUTE definition;
END $$;
COMMIT;
