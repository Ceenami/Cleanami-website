-- 0021 — least privilege for the `authenticated` role.
-- Idempotent (safe to re-run). Hand-written; not from `drizzle-kit generate`.
--
-- ############################################################################
-- ## DO NOT APPLY UNTIL THE NATIVE CLEANER APP HAS BEEN CHECKED.            ##
-- ## 0020 closes the anonymous hole and is safe on its own. This migration  ##
-- ## is the follow-up that removes write privileges from logged-in users.   ##
-- ############################################################################
--
-- Supabase grants `authenticated` INSERT/UPDATE/DELETE/TRUNCATE on every table
-- in `public`, leaving RLS as the only thing preventing one signed-in cleaner
-- from rewriting another's rows. RLS is enabled everywhere after 0020, so this
-- is defence in depth rather than an open hole — but it is the difference
-- between "one bad policy is a breach" and "one bad policy is a bug".
--
-- The WEBSITE needs none of these writes: it has exactly two PostgREST table
-- reads (hooks/useCurrentUser.ts -> users, sidebar -> app_settings) plus
-- realtime subscriptions, all of which are SELECT. Every website write goes
-- through a server route using Drizzle as `postgres`.
--
-- THE RISK IS THE NATIVE CLEANER APP, which shares this database and is not in
-- this repo. Tables it may write directly over PostgREST include availability,
-- gps_tracking_logs, push_notification_tokens, user_preferences,
-- onboarding_documents, capability_flags and swap_requests — all of which have
-- owner-scoped RLS policies, which is itself evidence someone expected direct
-- client writes. Confirm before applying; if the app does write directly, keep
-- the revoke and re-GRANT those specific tables at the bottom of this file.

-- Reads stay open and stay governed by RLS; writes go away.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public FROM authenticated;

-- Future tables inherit read-only for authenticated instead of full control.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLES FROM authenticated;

-- If the native app is confirmed to write any of these directly, uncomment the
-- matching line rather than reverting the whole migration.
-- GRANT INSERT, UPDATE, DELETE ON public.availability             TO authenticated;
-- GRANT INSERT, UPDATE, DELETE ON public.gps_tracking_logs        TO authenticated;
-- GRANT INSERT, UPDATE, DELETE ON public.push_notification_tokens TO authenticated;
-- GRANT INSERT, UPDATE, DELETE ON public.user_preferences         TO authenticated;
-- GRANT INSERT, UPDATE, DELETE ON public.onboarding_documents     TO authenticated;
-- GRANT INSERT, UPDATE, DELETE ON public.capability_flags         TO authenticated;
-- GRANT INSERT, UPDATE          ON public.swap_requests           TO authenticated;
