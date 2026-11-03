-- REVIEW/HANDOFF ONLY. Never apply to the shared live database from an agent.
-- Catalog checked read-only 2026-10-10. Additive; no paid job backfill/repricing.
BEGIN;
CREATE TABLE IF NOT EXISTS public.phase2c_property_checklists (
 property_id uuid PRIMARY KEY REFERENCES public.properties(id) ON DELETE CASCADE, revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
 published_revision integer NOT NULL DEFAULT 0 CHECK(published_revision>=0), draft jsonb, published jsonb,
 status text NOT NULL DEFAULT 'basic' CHECK(status IN ('basic','pending','published','rejected')), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.phase2c_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subject_id uuid NOT NULL, kind text NOT NULL, actor_id text NOT NULL,
 payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS phase2c_audit_subject_idx ON public.phase2c_audit(subject_id,created_at);
CREATE TABLE IF NOT EXISTS public.phase2c_availability_days (
 cleaner_id uuid NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE, date date NOT NULL, is_available boolean NOT NULL,
 on_call_eligible boolean NOT NULL, open_pool_eligible boolean NOT NULL, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 late boolean NOT NULL DEFAULT false, reopened_until timestamptz, actor_id text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(cleaner_id,date), CHECK(is_available OR (NOT on_call_eligible AND NOT open_pool_eligible))
);
CREATE INDEX IF NOT EXISTS phase2c_availability_date_idx ON public.phase2c_availability_days(date);
CREATE TABLE IF NOT EXISTS public.phase2c_property_exclusions (
 property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE, cleaner_id uuid NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500), actor_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(property_id,cleaner_id)
);
CREATE INDEX IF NOT EXISTS phase2c_exclusion_cleaner_idx ON public.phase2c_property_exclusions(cleaner_id);
CREATE TABLE IF NOT EXISTS public.phase2c_assignment_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE, outcome text NOT NULL,
 candidates jsonb NOT NULL, reason text, created_at timestamptz NOT NULL DEFAULT now(),
 policy_version text NOT NULL DEFAULT 'phase2c-v1', actor_id text, context jsonb
);
CREATE INDEX IF NOT EXISTS phase2c_assignment_job_idx ON public.phase2c_assignment_runs(job_id,created_at);
CREATE TABLE IF NOT EXISTS public.phase2c_property_policy (
 property_id uuid PRIMARY KEY REFERENCES public.properties(id) ON DELETE CASCADE, hot_tub_required boolean NOT NULL DEFAULT false,
 laundry_lead_required boolean NOT NULL DEFAULT false, admin_notes text NOT NULL DEFAULT '' CHECK(length(admin_notes)<=3000),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), actor_id text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.phase2c_public_job_notes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE, text text NOT NULL CHECK(length(trim(text)) BETWEEN 1 AND 1000),
 category text NOT NULL CHECK(category IN ('note','issue','restocking')), actor_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS phase2c_public_notes_job_idx ON public.phase2c_public_job_notes(job_id);
CREATE TABLE IF NOT EXISTS public.phase2c_evidence_drafts (
 job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE, cleaner_id uuid NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE, explanations jsonb NOT NULL, state jsonb,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(job_id,cleaner_id)
);
CREATE INDEX IF NOT EXISTS phase2c_draft_cleaner_idx ON public.phase2c_evidence_drafts(cleaner_id);
CREATE TABLE IF NOT EXISTS public.phase2c_reminder_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cleaner_id uuid NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE, period_start date NOT NULL,
 stage text NOT NULL CHECK(stage IN ('morning','last_call','missed')), status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','skipped')),
 attempts integer NOT NULL DEFAULT 0, error text, claimed_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(cleaner_id,period_start,stage)
);
CREATE INDEX IF NOT EXISTS phase2c_reminder_status_idx ON public.phase2c_reminder_deliveries(status);
ALTER TABLE public.jobs_to_cleaners ADD COLUMN IF NOT EXISTS frozen_hourly_rate_cents integer CHECK(frozen_hourly_rate_cents>0);
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['phase2c_property_checklists','phase2c_audit','phase2c_availability_days','phase2c_property_exclusions','phase2c_assignment_runs','phase2c_public_job_notes','phase2c_evidence_drafts','phase2c_reminder_deliveries','phase2c_property_policy'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', n);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', n);
 END LOOP;
END $$;
-- Server database role only; no direct mobile/PostgREST grants. Ownership in APIs.
COMMIT;
