-- OWNER REVIEW/APPLY ONLY after 0058-0060 and isolated TEST verification.
-- Passive, transactional intents only. No sends, backfill or rollout activation.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.phase3a_assert_candidate(uuid,uuid,uuid,text)') IS NULL
 THEN RAISE EXCEPTION 'Verify 0058 assignment guard before 0061'; END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.phase3a_notification_events (
 identity text PRIMARY KEY,
 kind text NOT NULL CHECK(kind IN ('subscription_purchase','one_off_booking','turnover_created','worker_removed_email','worker_removed_cleaner','term_end','gps_overdue','one_off_receipt')),
 job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
 subscription_id uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
 cleaner_id uuid REFERENCES public.cleaners(id) ON DELETE SET NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','claimed','sent','skipped','failed','unknown')),
 recipient text, outcome jsonb, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), claimed_at timestamptz
);
CREATE INDEX IF NOT EXISTS phase3a_notification_pending ON public.phase3a_notification_events(state,created_at);
CREATE INDEX IF NOT EXISTS phase3a_notification_job ON public.phase3a_notification_events(job_id);
CREATE INDEX IF NOT EXISTS notification_log_job_attempt ON public.notification_log(job_id,channel,trigger,created_at DESC);
CREATE INDEX IF NOT EXISTS notification_log_provider_message ON public.notification_log(provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS public.phase3a_message_status (
 message_sid text PRIMARY KEY CHECK(message_sid ~ '^(SM|MM)[a-fA-F0-9]{32}$'),
 status text NOT NULL CHECK(status IN ('accepted','queued','sending','sent','failed','undelivered','canceled','delivered','read')),
 rank text NOT NULL CHECK(rank IN ('0','1','2','3','4','5','6')), error_code text,
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.phase3a_notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phase3a_message_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.phase3a_notification_events,public.phase3a_message_status FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.phase3a_queue_booking_notice() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='subscriptions' THEN
  IF NEW.status::text='active' AND NEW.first_clean_payment_id IS NOT NULL THEN
   INSERT INTO phase3a_notification_events(identity,kind,subscription_id)
    VALUES('subscription_purchase:'||NEW.id,'subscription_purchase',NEW.id) ON CONFLICT DO NOTHING;
  END IF;
 ELSE
  IF TG_OP='INSERT' AND NEW.job_source::text='ical' THEN
   INSERT INTO phase3a_notification_events(identity,kind,job_id) VALUES('turnover_created:'||NEW.id,'turnover_created',NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  IF NEW.job_source::text IN ('customer_one_off','public_residential_booking') AND NEW.status::text<>'canceled'
   AND (NEW.payment_status::text='captured' OR NEW.payment_intent_id LIKE 'skip_%'
     OR NEW.addons_snapshot->'residentialPricing'->>'exception'='owner_comp') THEN
   INSERT INTO phase3a_notification_events(identity,kind,job_id) VALUES('one_off_booking:'||NEW.id,'one_off_booking',NEW.id) ON CONFLICT DO NOTHING;
   INSERT INTO phase3a_notification_events(identity,kind,job_id) VALUES('one_off_receipt:'||NEW.id,'one_off_receipt',NEW.id) ON CONFLICT DO NOTHING;
  END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS phase3a_queue_job_notice ON public.jobs;
CREATE TRIGGER phase3a_queue_job_notice AFTER INSERT OR UPDATE OF payment_status ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.phase3a_queue_booking_notice();
DROP TRIGGER IF EXISTS phase3a_queue_subscription_notice ON public.subscriptions;
CREATE TRIGGER phase3a_queue_subscription_notice AFTER INSERT OR UPDATE OF status ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.phase3a_queue_booking_notice();

CREATE OR REPLACE FUNCTION public.phase3a_queue_removed_notice() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE k text;
BEGIN
 IF TG_OP='UPDATE' AND NEW.role IS NOT DISTINCT FROM OLD.role THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM jobs WHERE id=OLD.job_id AND status::text IN ('assigned','unassigned'))
   OR current_setting('cleannami.assignment_source',true)='phase3a_property_priority' THEN RETURN OLD; END IF;
 -- The old membership identity plus transaction distinguishes genuine later role changes.
 FOREACH k IN ARRAY ARRAY['worker_removed_email','worker_removed_cleaner'] LOOP
  INSERT INTO phase3a_notification_events(identity,kind,job_id,cleaner_id)
   VALUES(k||':'||OLD.job_id||':'||OLD.cleaner_id||':'||txid_current()::text,k,OLD.job_id,OLD.cleaner_id) ON CONFLICT DO NOTHING;
 END LOOP;
 RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS phase3a_queue_removed_notice ON public.jobs_to_cleaners;
CREATE TRIGGER phase3a_queue_removed_notice AFTER DELETE OR UPDATE OF role ON public.jobs_to_cleaners FOR EACH ROW EXECUTE FUNCTION public.phase3a_queue_removed_notice();

-- Observational predicate: no row/advisory locks in a global COUNT/filter read.
-- Write paths still use the authoritative locking candidate/team guards.
CREATE OR REPLACE FUNCTION public.phase3a_candidate_is_eligible(jid uuid,cid uuid,worker uuid,assigned_role text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM jobs j JOIN cleaners c ON c.id=cid WHERE j.id=jid AND j.check_in_time IS NOT NULL
  AND j.status::text IN ('assigned','unassigned') AND c.account_status::text='active' AND c.eligible_for_assignments AND coalesce(c.reliability_score,100)>=80
  AND NOT EXISTS(SELECT 1 FROM evidence_packets e WHERE e.job_id=jid AND e.gps_check_in_timestamp IS NOT NULL)
  AND NOT EXISTS(SELECT 1 FROM phase2c_property_exclusions e WHERE e.property_id=j.property_id AND e.cleaner_id=cid)
  AND (j.service_type<>'residential_one_time' OR c.residential_qualified AND (NOT coalesce((j.addons_snapshot->>'petsAllowed')::boolean,false) OR c.pet_comfortable))
  AND CASE WHEN EXISTS(SELECT 1 FROM phase2c_availability_days d WHERE d.cleaner_id=cid AND d.date=(j.check_in_time AT TIME ZONE 'America/New_York')::date)
   THEN EXISTS(SELECT 1 FROM phase2c_availability_days d WHERE d.cleaner_id=cid AND d.date=(j.check_in_time AT TIME ZONE 'America/New_York')::date AND d.is_available)
   ELSE EXISTS(SELECT 1 FROM availability a WHERE a.cleaner_id=cid AND a.date=(j.check_in_time AT TIME ZONE 'America/New_York')::date)
    AND EXISTS(SELECT 1 FROM cleaner_availability_submissions a WHERE a.cleaner_id=cid AND a.period_start<=(j.check_in_time AT TIME ZONE 'America/New_York')::date AND a.period_end>=(j.check_in_time AT TIME ZONE 'America/New_York')::date) END
  AND CASE WHEN EXISTS(SELECT 1 FROM property_cleaners r WHERE r.property_id=j.property_id AND r.cleaner_id=cid AND r.tier::text='on_call')
   THEN coalesce((SELECT on_call_eligible FROM phase2c_availability_days WHERE cleaner_id=cid AND date=(j.check_in_time AT TIME ZONE 'America/New_York')::date),(SELECT on_call_eligible FROM availability WHERE cleaner_id=cid AND date=(j.check_in_time AT TIME ZONE 'America/New_York')::date),false)
   ELSE j.service_type='residential_one_time' OR EXISTS(SELECT 1 FROM property_cleaners r WHERE r.property_id=j.property_id AND r.cleaner_id=cid)
    OR coalesce((SELECT on_call_eligible OR open_pool_eligible FROM phase2c_availability_days WHERE cleaner_id=cid AND date=(j.check_in_time AT TIME ZONE 'America/New_York')::date),(SELECT on_call_eligible OR open_pool_eligible FROM availability WHERE cleaner_id=cid AND date=(j.check_in_time AT TIME ZONE 'America/New_York')::date),false) END
  AND NOT EXISTS(SELECT 1 FROM jobs_to_cleaners x JOIN jobs other ON other.id=x.job_id WHERE x.cleaner_id=cid AND other.id<>jid AND other.status::text<>'canceled'
   AND ((other.check_in_time AT TIME ZONE 'America/New_York')::date=(j.check_in_time AT TIME ZONE 'America/New_York')::date
    OR (other.check_in_time<CASE WHEN j.service_type='residential_one_time' THEN greatest(j.check_out_time,j.check_in_time+coalesce(j.expected_hours,4)*interval '1 hour') ELSE j.check_in_time+coalesce(j.expected_hours,4)*interval '1 hour' END
     AND CASE WHEN other.service_type='residential_one_time' THEN greatest(other.check_out_time,other.check_in_time+coalesce(other.expected_hours,4)*interval '1 hour') ELSE other.check_in_time+coalesce(other.expected_hours,4)*interval '1 hour' END>j.check_in_time)))
  AND (assigned_role<>'laundry_lead' OR c.has_laundry_lead_cert)
  AND (worker IS NULL OR EXISTS(SELECT 1 FROM jobs_to_cleaners x JOIN cleaners w ON w.id=x.cleaner_id WHERE x.job_id=jid AND x.cleaner_id=worker AND x.role::text IN ('primary','laundry_lead')
   AND (x.role::text<>'laundry_lead' OR c.has_laundry_lead_cert)
   AND (NOT(coalesce(j.addons_snapshot->>'hotTubServiceLevel','none')<>'none' OR coalesce((j.checklist_snapshot->'capabilityRequirements'->>'hotTub')::boolean,false)) OR NOT w.has_hot_tub_cert OR c.has_hot_tub_cert)))
 );
$$;
REVOKE ALL ON FUNCTION public.phase3a_queue_booking_notice(),public.phase3a_queue_removed_notice(),public.phase3a_candidate_is_eligible(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
COMMIT;
