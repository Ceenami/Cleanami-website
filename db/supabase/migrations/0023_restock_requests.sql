-- 0023 — restocking requests (task 1.16).
-- Idempotent (safe to re-run) to match this repo's hand-applied migration style.
-- Hand-written; NOT produced by `drizzle-kit generate`.
--
-- SCOPE (client-confirmed 2026-07-25, sensible-defaults build):
--   A cleaner raises a supply request from a job they are assigned to; an admin
--   works the queue (approve -> order -> fulfil, or decline). It is FREE: there
--   is deliberately no amount column and nothing here touches Stripe, pricing
--   or a customer charge. Spec §29 frames restocking as a future paid add-on;
--   until the client prices it, billing stays out of the data model rather than
--   sitting unused on the money path.

CREATE TABLE IF NOT EXISTS "restock_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The job the cleaner was on when they noticed. Nullable + ON DELETE SET NULL
  -- so purging old jobs never destroys the supply history for a property.
  "job_id" uuid REFERENCES "jobs"("id") ON DELETE SET NULL,
  "property_id" uuid NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
  "cleaner_id" uuid REFERENCES "cleaners"("id") ON DELETE SET NULL,
  "item" text NOT NULL,
  "quantity" integer DEFAULT 1 NOT NULL,
  "urgency" text DEFAULT 'normal' NOT NULL,
  "notes" text,
  "status" text DEFAULT 'requested' NOT NULL,
  "admin_notes" text,
  "resolved_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "resolved_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT restock_requests_item_not_blank CHECK (btrim("item") <> ''),
  CONSTRAINT restock_requests_quantity_valid
    CHECK ("quantity" > 0 AND "quantity" <= 999),
  CONSTRAINT restock_requests_urgency_valid
    CHECK ("urgency" IN ('low', 'normal', 'urgent')),
  CONSTRAINT restock_requests_status_valid
    CHECK ("status" IN ('requested', 'approved', 'ordered', 'fulfilled', 'declined'))
);

CREATE INDEX IF NOT EXISTS "restock_requests_status_idx"
  ON "restock_requests" ("status");
CREATE INDEX IF NOT EXISTS "restock_requests_property_idx"
  ON "restock_requests" ("property_id");
CREATE INDEX IF NOT EXISTS "restock_requests_cleaner_idx"
  ON "restock_requests" ("cleaner_id");

-- ---------------------------------------------------------------------------
-- RLS. Every write goes through the website's authenticated API over Drizzle
-- (the `postgres` role, which bypasses RLS). The SELECT policy exists so the
-- native cleaner app can read a cleaner's own requests over PostgREST later
-- without re-opening the table; it must NOT be able to write them directly —
-- that is the CleanWaves "self-reported accountability" trap (findings S1/S2),
-- and requests here are what an admin spends money on.
-- ---------------------------------------------------------------------------
ALTER TABLE public.restock_requests ENABLE ROW LEVEL SECURITY;

-- NOTE on the identity join: `cleaners.user_id` references `users.id`, the
-- app's own user row — NOT the Supabase auth uid, which lives in
-- `users.supabase_user_id` (see lib/cleaner-auth.ts, which resolves the cleaner
-- in exactly these two hops). The older policies from 0020 compare
-- `cleaners.user_id` directly against `auth.uid()`, which can never match and
-- therefore always denies. That fails closed, so it is not a hole — but it is
-- why this policy joins through `users` instead of copying that shape.
DROP POLICY IF EXISTS restock_requests_select_own_or_admin ON public.restock_requests;
CREATE POLICY restock_requests_select_own_or_admin ON public.restock_requests
  FOR SELECT TO authenticated
  USING (
    is_app_admin()
    OR cleaner_id IN (
      SELECT c.id
      FROM public.cleaners c
      JOIN public.users u ON u.id = c.user_id
      WHERE u.supabase_user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS restock_requests_admin_write ON public.restock_requests;
CREATE POLICY restock_requests_admin_write ON public.restock_requests
  FOR ALL TO authenticated USING (is_app_admin()) WITH CHECK (is_app_admin());

-- Belt and braces, as in 0022: re-assert the 0020/0021 posture for this table
-- rather than relying on the altered default privileges having been applied.
REVOKE ALL ON public.restock_requests FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.restock_requests FROM authenticated;
