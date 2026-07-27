-- 0024 — Repair the cleaner identity used by RLS. Idempotent (safe to re-run).
-- Hand-written; NOT produced by `drizzle-kit generate`.
--
-- WHY THIS EXISTS
-- ---------------
-- `cleaners.user_id` is a foreign key to `public.users.id` — the application's
-- own users table. `auth.uid()` returns `users.supabase_user_id`, a different
-- column holding a different value. Twenty policies compared the two directly:
--
--     cleaner_id IN (SELECT id FROM cleaners WHERE user_id = auth.uid())
--
-- Those predicates can never be true for anybody. Verified against production:
-- of 26 cleaners with `user_id` set, 26 match `users.id` and 0 match
-- `users.supabase_user_id`. Impersonating a real cleaner holding 7 assigned
-- jobs returned: cleaners 0, jobs 0, properties 0, jobs_to_cleaners 0.
--
-- The native cleaner app opens every screen with "find my cleaners row", so it
-- was not degraded, it was entirely non-functional. This is the fix.
--
-- `restock_requests_select_own_or_admin` (0023) already joined correctly and is
-- the shape copied here. The `users`-keyed and email-keyed policies
-- (users_*, notifications_*, and the customers/properties/subscriptions/
-- checklist_files family) were already correct and are deliberately untouched.
--
-- SCOPE DISCIPLINE
-- ----------------
-- This repairs *identity*, not privilege. Several policies below are FOR ALL;
-- fixing them restores their USING clause for reads, and their WITH CHECK still
-- cannot admit a write because `authenticated` holds no INSERT/UPDATE/DELETE
-- grant on any table in `public` (0021). Verified at time of writing: SELECT on
-- 43/43 tables, zero write grants. That is defence in depth working as designed
-- — do not add write grants to "finish" this migration; the app writes through
-- the authenticated cleaner API instead.
--
-- ROLLBACK
-- --------
-- Every prior policy body was captured before this ran; see
-- `_audit-private/policy-restore-*.sql`, which contains runnable CREATE POLICY
-- statements reproducing the exact pre-migration state.

-- ---------------------------------------------------------------------------
-- 1. The helper. One place to get the identity join right instead of twenty.
--
--    SECURITY DEFINER so it can traverse `users` regardless of the caller's own
--    row visibility — and so that using it in a policy ON `cleaners` does not
--    recurse, since the owner's query is not itself subject to RLS.
--    STABLE so the planner evaluates it once per statement rather than per row.
--    search_path is pinned: a SECURITY DEFINER function without it is a
--    privilege-escalation vector.
--    Mirrors the hardening already applied to `is_app_admin()`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_cleaner_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT c.id
  FROM public.cleaners c
  JOIN public.users u ON u.id = c.user_id
  WHERE u.supabase_user_id = (SELECT auth.uid())
  LIMIT 1
$$;

COMMENT ON FUNCTION public.current_cleaner_id() IS
  'The signed-in user''s cleaners.id, resolved via users.supabase_user_id. '
  'Takes no argument: identity comes only from auth.uid(), never from a caller-supplied value.';

REVOKE ALL ON FUNCTION public.current_cleaner_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_cleaner_id() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_cleaner_id() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. The twenty policies, rewritten. Pattern:
--      cleaner_id IN (SELECT id FROM cleaners WHERE user_id = auth.uid())
--        -> cleaner_id = public.current_cleaner_id()
--      user_id = auth.uid()            (on `cleaners` itself)
--        -> id = public.current_cleaner_id()
--    Customer/email branches are preserved verbatim — they were already correct.
-- ---------------------------------------------------------------------------

-- cleaners ------------------------------------------------------------------
DROP POLICY IF EXISTS cleaners_select_owner ON public.cleaners;
CREATE POLICY cleaners_select_owner ON public.cleaners
  FOR SELECT TO authenticated
  USING (id = public.current_cleaner_id() OR is_app_admin());

DROP POLICY IF EXISTS cleaners_update_owner ON public.cleaners;
CREATE POLICY cleaners_update_owner ON public.cleaners
  FOR UPDATE TO authenticated
  USING (id = public.current_cleaner_id() OR is_app_admin())
  WITH CHECK (id = public.current_cleaner_id() OR is_app_admin());

-- jobs ----------------------------------------------------------------------
-- The cleaners join is dropped: jobs_to_cleaners.cleaner_id is already the
-- value we are comparing, so joining back through cleaners added nothing but
-- the broken predicate. The customer branch is unchanged.
DROP POLICY IF EXISTS jobs_select_assigned_or_customer_or_admin ON public.jobs;
CREATE POLICY jobs_select_assigned_or_customer_or_admin ON public.jobs
  FOR SELECT TO authenticated
  USING (
    is_app_admin()
    OR EXISTS (
      SELECT 1 FROM public.jobs_to_cleaners jtc
      WHERE jtc.job_id = jobs.id
        AND jtc.cleaner_id = public.current_cleaner_id()
    )
    OR EXISTS (
      SELECT 1 FROM public.subscriptions s
      JOIN public.customers cu ON cu.id = s.customer_id
      WHERE s.id = jobs.subscription_id
        AND cu.email = COALESCE((SELECT auth.jwt() ->> 'email'), '')
    )
  );

DROP POLICY IF EXISTS jobs_update_assigned_or_admin ON public.jobs;
CREATE POLICY jobs_update_assigned_or_admin ON public.jobs
  FOR UPDATE TO authenticated
  USING (
    is_app_admin()
    OR EXISTS (
      SELECT 1 FROM public.jobs_to_cleaners jtc
      WHERE jtc.job_id = jobs.id
        AND jtc.cleaner_id = public.current_cleaner_id()
    )
  )
  WITH CHECK (
    is_app_admin()
    OR EXISTS (
      SELECT 1 FROM public.jobs_to_cleaners jtc
      WHERE jtc.job_id = jobs.id
        AND jtc.cleaner_id = public.current_cleaner_id()
    )
  );

-- jobs_to_cleaners ----------------------------------------------------------
DROP POLICY IF EXISTS jobs_to_cleaners_select_owner_or_admin ON public.jobs_to_cleaners;
CREATE POLICY jobs_to_cleaners_select_owner_or_admin ON public.jobs_to_cleaners
  FOR SELECT TO authenticated
  USING (is_app_admin() OR cleaner_id = public.current_cleaner_id());

-- evidence_packets ----------------------------------------------------------
-- The `jobs` join was redundant (jobs_to_cleaners.job_id is FK to jobs.id).
DROP POLICY IF EXISTS evidence_packets_owner_all ON public.evidence_packets;
CREATE POLICY evidence_packets_owner_all ON public.evidence_packets
  FOR ALL TO authenticated
  USING (
    is_app_admin()
    OR EXISTS (
      SELECT 1 FROM public.jobs_to_cleaners jtc
      WHERE jtc.job_id = evidence_packets.job_id
        AND jtc.cleaner_id = public.current_cleaner_id()
    )
  )
  WITH CHECK (
    is_app_admin()
    OR EXISTS (
      SELECT 1 FROM public.jobs_to_cleaners jtc
      WHERE jtc.job_id = evidence_packets.job_id
        AND jtc.cleaner_id = public.current_cleaner_id()
    )
  );

-- swap_requests -------------------------------------------------------------
DROP POLICY IF EXISTS swap_requests_select_participant_or_admin ON public.swap_requests;
CREATE POLICY swap_requests_select_participant_or_admin ON public.swap_requests
  FOR SELECT TO authenticated
  USING (
    is_app_admin()
    OR original_cleaner_id = public.current_cleaner_id()
    OR replacement_cleaner_id = public.current_cleaner_id()
  );

-- ratings -------------------------------------------------------------------
DROP POLICY IF EXISTS ratings_select_participant_or_admin ON public.ratings;
CREATE POLICY ratings_select_participant_or_admin ON public.ratings
  FOR SELECT TO authenticated
  USING (
    is_app_admin()
    OR cleaner_id = public.current_cleaner_id()
    OR EXISTS (
      SELECT 1 FROM public.customers cu
      WHERE cu.id = ratings.customer_id
        AND (SELECT auth.jwt() ->> 'email') IS NOT NULL
        AND cu.email = (SELECT auth.jwt() ->> 'email')
    )
  );

-- Straightforward cleaner_id ownership ---------------------------------------
DROP POLICY IF EXISTS availability_owner_all ON public.availability;
CREATE POLICY availability_owner_all ON public.availability
  FOR ALL TO authenticated
  USING (cleaner_id = public.current_cleaner_id() OR is_app_admin())
  WITH CHECK (cleaner_id = public.current_cleaner_id() OR is_app_admin());

DROP POLICY IF EXISTS capability_flags_owner_all ON public.capability_flags;
CREATE POLICY capability_flags_owner_all ON public.capability_flags
  FOR ALL TO authenticated
  USING (cleaner_id = public.current_cleaner_id() OR is_app_admin())
  WITH CHECK (cleaner_id = public.current_cleaner_id() OR is_app_admin());

DROP POLICY IF EXISTS gps_tracking_logs_owner_all ON public.gps_tracking_logs;
CREATE POLICY gps_tracking_logs_owner_all ON public.gps_tracking_logs
  FOR ALL TO authenticated
  USING (cleaner_id = public.current_cleaner_id() OR is_app_admin())
  WITH CHECK (cleaner_id = public.current_cleaner_id() OR is_app_admin());

DROP POLICY IF EXISTS onboarding_documents_owner_all ON public.onboarding_documents;
CREATE POLICY onboarding_documents_owner_all ON public.onboarding_documents
  FOR ALL TO authenticated
  USING (cleaner_id = public.current_cleaner_id() OR is_app_admin())
  WITH CHECK (cleaner_id = public.current_cleaner_id() OR is_app_admin());

DROP POLICY IF EXISTS push_notification_tokens_owner_all ON public.push_notification_tokens;
CREATE POLICY push_notification_tokens_owner_all ON public.push_notification_tokens
  FOR ALL TO authenticated
  USING (cleaner_id = public.current_cleaner_id() OR is_app_admin())
  WITH CHECK (cleaner_id = public.current_cleaner_id() OR is_app_admin());

DROP POLICY IF EXISTS user_preferences_owner_all ON public.user_preferences;
CREATE POLICY user_preferences_owner_all ON public.user_preferences
  FOR ALL TO authenticated
  USING (cleaner_id = public.current_cleaner_id() OR is_app_admin())
  WITH CHECK (cleaner_id = public.current_cleaner_id() OR is_app_admin());

DROP POLICY IF EXISTS cleaner_badges_select_owner ON public.cleaner_badges;
CREATE POLICY cleaner_badges_select_owner ON public.cleaner_badges
  FOR SELECT TO authenticated
  USING (cleaner_id = public.current_cleaner_id() OR is_app_admin());

DROP POLICY IF EXISTS job_stats_select_owner ON public.job_stats;
CREATE POLICY job_stats_select_owner ON public.job_stats
  FOR SELECT TO authenticated
  USING (cleaner_id = public.current_cleaner_id() OR is_app_admin());

DROP POLICY IF EXISTS payouts_select_cleaner_or_admin ON public.payouts;
CREATE POLICY payouts_select_cleaner_or_admin ON public.payouts
  FOR SELECT TO authenticated
  USING (is_app_admin() OR cleaner_id = public.current_cleaner_id());

DROP POLICY IF EXISTS property_cleaners_select_owner_or_admin ON public.property_cleaners;
CREATE POLICY property_cleaners_select_owner_or_admin ON public.property_cleaners
  FOR SELECT TO authenticated
  USING (is_app_admin() OR cleaner_id = public.current_cleaner_id());

DROP POLICY IF EXISTS reliability_checks_select_owner_or_admin ON public.reliability_checks;
CREATE POLICY reliability_checks_select_owner_or_admin ON public.reliability_checks
  FOR SELECT TO authenticated
  USING (is_app_admin() OR cleaner_id = public.current_cleaner_id());

DROP POLICY IF EXISTS reliability_events_select_owner_or_admin ON public.reliability_events;
CREATE POLICY reliability_events_select_owner_or_admin ON public.reliability_events
  FOR SELECT TO authenticated
  USING (is_app_admin() OR cleaner_id = public.current_cleaner_id());

-- ---------------------------------------------------------------------------
-- 3. properties — add the missing cleaner branch.
--
-- Not one of the twenty broken policies: `properties_select_owner` was correct
-- for customers (keyed on auth.jwt()->>'email') and for admins, but it never
-- had a cleaner branch at all, so an assigned cleaner could not read the
-- property they were sent to. Confirmed by impersonation: with every other
-- policy repaired, properties still returned 0 of 5.
--
-- This is not cosmetic. The app reads `default_check_out_time` to decide
-- whether check-in is too early, and bedrooms/bathrooms/sqft to compute the
-- required photo counts and the team size. Without it those gates misbehave and
-- no job shows an address.
--
-- Scoped to properties the caller actually has a job at — not all properties.
-- The customer and admin branches are preserved verbatim; the policy applies to
-- PUBLIC exactly as before, so customer access is unchanged.
--
-- `customers` is deliberately NOT given a cleaner branch: spec §21.2 says
-- cleaners see their jobs, not customer personal or payment details.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS properties_select_owner ON public.properties;
CREATE POLICY properties_select_owner ON public.properties
  FOR SELECT
  USING (
    (EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = properties.customer_id
        AND c.email = COALESCE((SELECT auth.jwt() ->> 'email'), '')
    ))
    OR is_app_admin()
    OR EXISTS (
      SELECT 1
      FROM public.jobs j
      JOIN public.jobs_to_cleaners jtc ON jtc.job_id = j.id
      WHERE j.property_id = properties.id
        AND jtc.cleaner_id = public.current_cleaner_id()
    )
  );
