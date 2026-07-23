-- Task 1.21 — private evidence storage.
-- Idempotent (safe to re-run) to match this repo's hand-applied migration style.
-- The drizzle-kit meta snapshot is stale; this migration is hand-written and is
-- NOT produced by `drizzle-kit generate`.
--
-- Evidence photos (interior photos of customers' homes), property checklists,
-- and pricing CSVs were served from PUBLIC storage buckets via getPublicUrl.
-- A public bucket's `/object/public/...` endpoint returns the file to anyone who
-- has (or guesses) the URL, and those permanent URLs were persisted in the DB.
-- This flips the buckets private; the app now mints short-lived signed URLs
-- server-side with the service role (see lib/storage/signed-url.ts), which work
-- via a signed token and do NOT require a storage.objects SELECT policy.

-- 1. Make the buckets private. Setting public = false disables the
--    `/object/public/<bucket>/...` endpoint entirely for these buckets, which is
--    what makes the previously-leaked public URLs stop resolving.
UPDATE storage.buckets
SET public = false
WHERE id IN ('evidence-photos', 'checklists', 'pricing-files');

-- 2. Keep the cleaner evidence-upload path working. That upload runs as an
--    authenticated user (cookie session, anon key) and so is subject to
--    storage.objects RLS. checklists uploads use the service role (bypasses RLS)
--    and pricing uploads rely on their existing policy, so only evidence-photos
--    needs an INSERT policy defined here. App-level guards (cleaner auth + job
--    assignment) remain the primary authorization; this policy just permits the
--    write at the storage layer. RLS is already enabled on storage.objects by
--    Supabase, so no ALTER TABLE ... ENABLE is issued (avoids an ownership error).
DROP POLICY IF EXISTS "evidence_photos_authenticated_insert" ON storage.objects;
CREATE POLICY "evidence_photos_authenticated_insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'evidence-photos');

-- NOTE FOR DEPLOY: if this Supabase project was previously configured (via the
-- dashboard) with a policy granting public/anon SELECT on any of these three
-- buckets, drop it — reads are served ONLY through signed URLs now, and a
-- lingering public-read policy would re-open the exposure this migration closes.
