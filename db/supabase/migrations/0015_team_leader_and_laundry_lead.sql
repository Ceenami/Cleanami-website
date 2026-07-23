-- Tasks 1.11/1.12 — multi-cleaner team assignment + Laundry Lead designation.
-- Idempotent; hand-written in this repo's migration style (not drizzle-kit gen).

-- Team Leader flag on the job↔cleaner link. The assignment engine assigns the
-- full team size as primaries and marks exactly one as the Team Leader (highest
-- reliability, spec §3). No extra pay — display/role clarity only.
ALTER TABLE "jobs_to_cleaners"
  ADD COLUMN IF NOT EXISTS "is_team_leader" boolean DEFAULT false NOT NULL;

-- Per-cleaner Laundry Lead eligibility, mirroring has_hot_tub_cert. Off-site
-- laundry jobs designate one team member as Laundry Lead (the $5/load bonus,
-- spec §3/§8). Preference goes to a laundry-lead-eligible cleaner.
ALTER TABLE "cleaners"
  ADD COLUMN IF NOT EXISTS "has_laundry_lead_cert" boolean DEFAULT false NOT NULL;
