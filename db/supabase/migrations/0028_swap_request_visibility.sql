-- 0028 — cleaner swap requests: capture why, and make the request visible to
-- admins the moment it is raised.
-- Idempotent (safe to re-run) to match this repo's hand-applied migration
-- style. Hand-written; NOT produced by `drizzle-kit generate`.
--
-- Two gaps this closes:
--   1. A swap request carried no explanation, so an admin approving or denying
--      one had nothing to decide on beyond the cleaner's name and the address.
--   2. Nothing anywhere wrote an admin-addressed notification, so a request
--      only existed inside a sub-tab of Job Oversight that nobody had reason
--      to open. The notifications table and the header bell already existed;
--      only the enum value for this event was missing.

ALTER TABLE "swap_requests"
  ADD COLUMN IF NOT EXISTS "reason" text;

-- Postgres allows ADD VALUE inside a transaction block from v12 on, provided
-- the new label is not used in the same transaction — inserts happen later,
-- from the app, so that holds.
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'swap_requested';
