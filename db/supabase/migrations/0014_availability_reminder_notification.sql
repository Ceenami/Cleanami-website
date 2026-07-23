-- Task 1.20 — add the availability-reminder cleaner notification type.
-- Idempotent (IF NOT EXISTS); hand-written in this repo's migration style, not
-- produced by drizzle-kit generate. Matches the 0004 enum-value precedent.

-- The Sunday/Friday "submit your availability" reminder (spec §16.2) is a
-- distinct cleaner notification type. Adding it lets it be stored in-app
-- alongside the existing job_reminder / assignment notifications.
ALTER TYPE "public"."notification_type"
  ADD VALUE IF NOT EXISTS 'availability_reminder';
