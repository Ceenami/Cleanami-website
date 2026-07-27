-- 0025 — Constrain storage writes to the caller's own namespace, and bound
-- object size and type. Idempotent (safe to re-run).
-- Hand-written; NOT produced by `drizzle-kit generate`.
--
-- WHY THIS EXISTS
-- ---------------
-- `anon` and `authenticated` hold ALL privileges on `storage.objects` (the
-- Supabase default), so RLS is the only control. There were exactly three
-- policies, all INSERT, and two of them tested `bucket_id` and nothing else:
--
--     evidence_photos_authenticated_insert       WITH CHECK (bucket_id = 'evidence-photos')
--     onboarding_documents_authenticated_insert  WITH CHECK (bucket_id = 'onboarding-documents')
--
-- No path prefix, no owner test. Any authenticated user could therefore write
-- to ANY path in either bucket — including another cleaner's
-- `onboarding-documents/{their-id}/w9-*.pdf`, where W-9 tax forms live — and
-- could plant evidence under a job they were never assigned to. With no
-- `file_size_limit` and no `allowed_mime_types` on any bucket, it was also an
-- unbounded upload vector for any account that could sign up.
--
-- Reads were never exposed: there is no SELECT policy at all, and the website
-- hands out short-lived signed URLs using the service role. That stays true —
-- this migration adds no SELECT policy.
--
-- ON "DON'T TRUST THE CLIENT-SUPPLIED PATH"
-- -----------------------------------------
-- These policies do not *trust* the path, they *constrain* it. The client still
-- chooses a path; the database refuses any path whose first segment is not the
-- caller's own cleaner id, and (for evidence) whose second segment is not a job
-- they are actually assigned to. Ownership is derived from auth.uid() via
-- current_cleaner_id() (0024), never from the request body.
--
-- PATH CONVENTIONS (verified against the live objects before writing this)
-- -----------------------------------------------------------------------
--   evidence-photos       {cleanerId}/{jobId}/{roomKey}/{timestamp}_{name}
--   onboarding-documents  {cleanerId}/{docType}-{timestamp}.{ext}
-- `storage.foldername()` returns the directory segments only, so [1] is the
-- first path segment and [2] the second. A path with too few segments yields
-- NULL and fails the check — it fails closed.
--
-- NOTE: this deliberately enforces the *server* upload convention, i.e. the one
-- `app/api/cleaner/jobs/[id]/evidence/upload/route.ts` already writes. The
-- native app's older direct-to-storage path (`{jobId}/{type}/...`) does not
-- satisfy it; the app is being migrated onto that endpoint, which is where the
-- photo-count and MIME checks live anyway.

-- ---------------------------------------------------------------------------
-- 1. evidence-photos — first segment must be the caller, second must be a job
--    they are assigned to.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS evidence_photos_authenticated_insert ON storage.objects;
DROP POLICY IF EXISTS evidence_photos_owner_insert ON storage.objects;
CREATE POLICY evidence_photos_owner_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'evidence-photos'
    AND (storage.foldername(name))[1] = public.current_cleaner_id()::text
    AND EXISTS (
      SELECT 1 FROM public.jobs_to_cleaners jtc
      WHERE jtc.job_id::text = (storage.foldername(name))[2]
        AND jtc.cleaner_id = public.current_cleaner_id()
    )
  );

-- ---------------------------------------------------------------------------
-- 2. onboarding-documents — first segment must be the caller's own id.
--    This is the bucket holding W-9s; it is the one that mattered most.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS onboarding_documents_authenticated_insert ON storage.objects;
DROP POLICY IF EXISTS onboarding_documents_owner_insert ON storage.objects;
CREATE POLICY onboarding_documents_owner_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'onboarding-documents'
    AND (storage.foldername(name))[1] = public.current_cleaner_id()::text
  );

-- `pricing_files_admin_insert` was already correctly gated on is_app_admin()
-- and is left exactly as it is.

-- ---------------------------------------------------------------------------
-- 3. Bucket-level size and type limits.
--    Belt and braces: the upload route already rejects >10MB and non-image
--    types, but the route is not the only thing holding a token. Limits here
--    are a superset of the route's so they never reject something the route
--    accepted — they exist to bound what bypasses the route.
--    heic/heif are included because that is what iPhones produce by default.
-- ---------------------------------------------------------------------------
UPDATE storage.buckets
   SET file_size_limit = 15728640, -- 15 MB
       allowed_mime_types = ARRAY[
         'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'
       ]
 WHERE id = 'evidence-photos';

UPDATE storage.buckets
   SET file_size_limit = 10485760, -- 10 MB
       allowed_mime_types = ARRAY[
         'application/pdf', 'image/jpeg', 'image/png', 'image/webp'
       ]
 WHERE id = 'onboarding-documents';

UPDATE storage.buckets
   SET file_size_limit = 10485760, -- 10 MB
       allowed_mime_types = ARRAY[
         'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
       ]
 WHERE id = 'checklists';

UPDATE storage.buckets
   SET file_size_limit = 20971520, -- 20 MB
       allowed_mime_types = ARRAY[
         'text/csv', 'application/vnd.ms-excel',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
       ]
 WHERE id = 'pricing-files';
