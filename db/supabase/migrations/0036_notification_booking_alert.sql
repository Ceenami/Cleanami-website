-- 0036 — add 'booking_alert' to notification_type.
--
-- NOT YET APPLIED TO PRODUCTION. Test project only; production migrations are
-- applied by hand after review. Safe to re-run.
--
-- Its own file because Postgres will not let you use an enum value in the same
-- transaction that adds it, so this cannot be bundled with anything that then
-- inserts a booking_alert row.
--
-- The value is for "a new residential booking arrived, staff it". The existing
-- eleven values are all cleaner- or workflow-facing, and notifyAdmins only
-- narrows to three of them. Reusing 'assignment' was the alternative and was
-- rejected: we already emit an assignment alert when the engine *fails* to
-- staff a residential job, so both events would land on the same
-- (type, job_id) pair and the bell would be ambiguous.
--
-- If this is not applied before the code deploys, notifyAdmins catches its own
-- insert failure and returns 0, so the booking still completes — you just lose
-- the admin bell. Apply 0035 first, then this.

ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'booking_alert';

-- Check:  SELECT unnest(enum_range(NULL::notification_type));   -- 12 values
--
-- Apply with (hand this to a human, do not run it):
--   psql "$PRODUCTION_DATABASE_URL" -f db/supabase/migrations/0036_notification_booking_alert.sql
