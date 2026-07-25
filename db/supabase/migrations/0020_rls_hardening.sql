-- 0020 — RLS hardening: close the anonymous read/write hole on the public schema.
-- Idempotent (safe to re-run) to match this repo's hand-applied migration style.
-- Hand-written; NOT produced by `drizzle-kit generate`.
--
-- WHY THIS EXISTS
-- ---------------
-- Supabase grants `anon` and `authenticated` ALL privileges on every table in
-- `public` by default and relies entirely on RLS to claw that back. Eight tables
-- had RLS switched off (the "Unrestricted" badge in the dashboard), so they were
-- readable AND writable by anyone holding the anon key — which ships in the
-- browser bundle and is therefore public. Verified against production: an
-- unauthenticated GET /rest/v1/cleaner_invitations returned live applicant
-- e-mail addresses.
--
-- The worst of it is not the read. `cleaner_invitations` is the cleaner signup
-- allowlist (lib/queries/cleaner-invitations.ts::assertCleanerEmailApproved),
-- so INSERT rights on it are a self-service path to a cleaner account, and
-- `platform_config` drives first-clean discount pricing.
--
-- The website itself never touches PostgREST for table data — everything goes
-- through Drizzle as the `postgres` role, which owns these tables and is not
-- FORCE'd, so it bypasses RLS. Enabling RLS here costs the server nothing.

-- ---------------------------------------------------------------------------
-- 1. Enable RLS on the eight unprotected tables.
--    Deny-by-default: with RLS on and no matching policy, anon/authenticated
--    see nothing. Policies below re-open only the paths that have a real caller.
-- ---------------------------------------------------------------------------
ALTER TABLE public.cleaner_audit_logs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cleaner_invitations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cleaner_signup_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_config         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processed_stripe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_cleaners       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ratings                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_disputes         ENABLE ROW LEVEL SECURITY;

-- Admin-only tables. Every write already happens server-side over Drizzle; these
-- policies exist so an admin dashboard could read them over PostgREST without
-- re-opening anything else.
DROP POLICY IF EXISTS cleaner_audit_logs_admin_only ON public.cleaner_audit_logs;
CREATE POLICY cleaner_audit_logs_admin_only ON public.cleaner_audit_logs
  FOR ALL TO authenticated USING (is_app_admin()) WITH CHECK (is_app_admin());

DROP POLICY IF EXISTS cleaner_invitations_admin_only ON public.cleaner_invitations;
CREATE POLICY cleaner_invitations_admin_only ON public.cleaner_invitations
  FOR ALL TO authenticated USING (is_app_admin()) WITH CHECK (is_app_admin());

DROP POLICY IF EXISTS cleaner_signup_attempts_admin_only ON public.cleaner_signup_attempts;
CREATE POLICY cleaner_signup_attempts_admin_only ON public.cleaner_signup_attempts
  FOR ALL TO authenticated USING (is_app_admin()) WITH CHECK (is_app_admin());

DROP POLICY IF EXISTS platform_config_admin_only ON public.platform_config;
CREATE POLICY platform_config_admin_only ON public.platform_config
  FOR ALL TO authenticated USING (is_app_admin()) WITH CHECK (is_app_admin());

DROP POLICY IF EXISTS stripe_disputes_admin_only ON public.stripe_disputes;
CREATE POLICY stripe_disputes_admin_only ON public.stripe_disputes
  FOR ALL TO authenticated USING (is_app_admin()) WITH CHECK (is_app_admin());

-- processed_stripe_events is Stripe webhook idempotency bookkeeping. It has no
-- PostgREST caller at all, so it intentionally gets RLS with ZERO policies.

-- property_cleaners: a cleaner may see the assignments that name them.
DROP POLICY IF EXISTS property_cleaners_select_owner_or_admin ON public.property_cleaners;
CREATE POLICY property_cleaners_select_owner_or_admin ON public.property_cleaners
  FOR SELECT TO authenticated
  USING (
    is_app_admin()
    OR cleaner_id IN (
      SELECT c.id FROM public.cleaners c WHERE c.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS property_cleaners_admin_write ON public.property_cleaners;
CREATE POLICY property_cleaners_admin_write ON public.property_cleaners
  FOR ALL TO authenticated USING (is_app_admin()) WITH CHECK (is_app_admin());

-- ratings: visible to the rated cleaner, the customer who left it, and admins.
-- Note the identity test is written as an explicit NULL guard rather than the
-- COALESCE(..., '') idiom used by the older policies — see section 5.
DROP POLICY IF EXISTS ratings_select_participant_or_admin ON public.ratings;
CREATE POLICY ratings_select_participant_or_admin ON public.ratings
  FOR SELECT TO authenticated
  USING (
    is_app_admin()
    OR cleaner_id IN (
      SELECT c.id FROM public.cleaners c WHERE c.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.customers cu
      WHERE cu.id = ratings.customer_id
        AND (SELECT auth.jwt() ->> 'email') IS NOT NULL
        AND cu.email = (SELECT auth.jwt() ->> 'email')
    )
  );

DROP POLICY IF EXISTS ratings_admin_write ON public.ratings;
CREATE POLICY ratings_admin_write ON public.ratings
  FOR ALL TO authenticated USING (is_app_admin()) WITH CHECK (is_app_admin());

-- ---------------------------------------------------------------------------
-- 2. Make the existing policies actually evaluate.
--    EXECUTE on is_app_admin() had been revoked from anon and authenticated, so
--    every policy referencing it raised SQLSTATE 42501 "permission denied for
--    function is_app_admin" instead of returning true/false. That failed closed,
--    but it also meant the 32 RLS-enabled tables were secure by accident, and it
--    breaks legitimate callers: hooks/useCurrentUser.ts reads `users` and
--    components/dashbboard/layout/sidebar reads `app_settings` over PostgREST,
--    and every realtime postgres_changes subscription needs a policy that
--    returns a value rather than erroring.
--    anon is deliberately NOT granted execute; it has no business calling this.
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.is_app_admin() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Storage: replace the bucket-agnostic upload policy.
--    "Allow authenticated uploads q9t29c_0" permitted INSERT into ANY bucket for
--    ANY authenticated user, gated only on auth.role() = 'authenticated'. A
--    cleaner could write into pricing-files or checklists. Replaced with
--    per-bucket policies covering the two buckets that genuinely upload with a
--    user session (checklists uploads use the service role and need no policy).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow authenticated uploads q9t29c_0" ON storage.objects;

-- Admin-only CSV uploads (lib/actions/pricing.actions.ts already checks admin;
-- this is the same rule enforced at the storage layer).
DROP POLICY IF EXISTS pricing_files_admin_insert ON storage.objects;
CREATE POLICY pricing_files_admin_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'pricing-files' AND is_app_admin());

-- Cleaner onboarding documents, uploaded by the native app. Nothing in this
-- repo touches this bucket, so this policy deliberately only restores what the
-- dropped policy already allowed for THIS bucket rather than guessing at the
-- app's object-path convention. Tightening it to a per-user folder prefix is
-- migration 0019 on fix/private-onboarding-documents (never applied here);
-- apply that once the native app's upload path has been confirmed.
DROP POLICY IF EXISTS onboarding_documents_authenticated_insert ON storage.objects;
CREATE POLICY onboarding_documents_authenticated_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'onboarding-documents');

-- evidence-photos already has evidence_photos_authenticated_insert from 0013.

-- ---------------------------------------------------------------------------
-- 4. Revoke anon's blanket privileges on the public schema.
--    Nothing in this codebase reads or writes a table as anon: the only
--    anon-key client that could (createPublicFormClient in lib/supabase/server.ts)
--    has no callers, and every public page fetches through server routes backed
--    by Drizzle. Logged-in users authenticate as `authenticated`, not `anon`,
--    so this does not affect them.
--    This is the belt to RLS's braces — if a future table ships with RLS off,
--    anon still cannot reach it.
-- ---------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL ROUTINES  IN SCHEMA public FROM anon;

-- Stop new tables from being auto-granted to anon. Only defaults owned by roles
-- we can act as are changeable; `postgres` owns every table this app creates.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon;

-- ---------------------------------------------------------------------------
-- 5. Close the COALESCE(auth.jwt() ->> 'email', '') footgun.
--    The customers / properties / subscriptions / checklist_files policies match
--    the caller with `email = COALESCE(auth.jwt() ->> 'email', '')`. A request
--    whose JWT carries no email collapses to '', so any row with an empty-string
--    e-mail would match for everybody. The column is NOT NULL and currently has
--    no empty values, so this is not exploitable today; the constraint keeps it
--    that way without rewriting eight working policies.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ALTER TABLE public.customers
    ADD CONSTRAINT customers_email_not_blank CHECK (email <> '');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
