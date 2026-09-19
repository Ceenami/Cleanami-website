-- NOT YET APPLIED TO PRODUCTION.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS checklist_snapshot jsonb;
