-- 0022 — promo codes (task 1.8).
-- Idempotent (safe to re-run) to match this repo's hand-applied migration style.
-- Hand-written; NOT produced by `drizzle-kit generate`.
--
-- SCOPE (client-confirmed 2026-07-25, sensible-defaults build):
--   * Redeemed by the CUSTOMER at booking checkout, validated server-side.
--   * Discounts the PREPAID FIRST CLEAN ONLY. Recurring cleans are never
--     touched, so nothing here reaches the pre-authorize cron and a code can
--     never silently ride along for months.
--   * Applied AFTER the subscription-term discount and AFTER the global
--     first-clean discount, on whatever is left.

CREATE TABLE IF NOT EXISTS "promo_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stored upper-cased and trimmed; lookups normalise the same way so the
  -- customer can type "spring25". UNIQUE gives us the lookup index too.
  "code" text NOT NULL UNIQUE,
  "description" text,
  -- 'percent' -> discount_value is 1..100; 'fixed' -> discount_value is CENTS.
  "discount_type" text NOT NULL,
  "discount_value" integer NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  -- NULL = unlimited. redemption_count only counts COMPLETED bookings, so an
  -- abandoned checkout never burns a code.
  "max_redemptions" integer,
  "redemption_count" integer DEFAULT 0 NOT NULL,
  "starts_at" timestamptz,
  "expires_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT promo_codes_code_not_blank CHECK (btrim("code") <> ''),
  CONSTRAINT promo_codes_discount_type_valid
    CHECK ("discount_type" IN ('percent', 'fixed')),
  CONSTRAINT promo_codes_discount_value_valid CHECK (
    ("discount_type" = 'percent' AND "discount_value" BETWEEN 1 AND 100)
    OR ("discount_type" = 'fixed' AND "discount_value" > 0)
  ),
  CONSTRAINT promo_codes_max_redemptions_valid
    CHECK ("max_redemptions" IS NULL OR "max_redemptions" > 0),
  CONSTRAINT promo_codes_window_valid CHECK (
    "starts_at" IS NULL OR "expires_at" IS NULL OR "expires_at" > "starts_at"
  )
);

-- One row per code actually used on a completed booking. `payment_intent_id`
-- is UNIQUE so replaying the onboarding completion for the same PaymentIntent
-- cannot double-count a redemption (same idempotency rule the reserve ledger
-- uses — see 0012).
CREATE TABLE IF NOT EXISTS "promo_redemptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "promo_code_id" uuid NOT NULL REFERENCES "promo_codes"("id") ON DELETE CASCADE,
  -- Snapshot of the code text as typed at redemption: the promo_codes row can
  -- be renamed or deleted later, the historical record should not change.
  "code" text NOT NULL,
  "customer_email" text NOT NULL,
  "customer_id" uuid REFERENCES "customers"("id") ON DELETE SET NULL,
  "subscription_id" uuid REFERENCES "subscriptions"("id") ON DELETE SET NULL,
  "payment_intent_id" text NOT NULL UNIQUE,
  "original_amount_cents" integer NOT NULL,
  "discount_amount_cents" integer NOT NULL,
  "final_amount_cents" integer NOT NULL,
  "redeemed_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "promo_redemptions_code_idx"
  ON "promo_redemptions" ("promo_code_id");
CREATE INDEX IF NOT EXISTS "promo_redemptions_email_idx"
  ON "promo_redemptions" (lower("customer_email"));

-- ---------------------------------------------------------------------------
-- RLS. Both tables are admin-owned and written exclusively server-side over
-- Drizzle (the `postgres` role, which bypasses RLS). Enable RLS so a future
-- PostgREST caller is denied by default; 0020 already revoked anon's blanket
-- grants and 0021 left `authenticated` read-only, so these policies only
-- decide what an admin dashboard could READ.
--
-- Note there is deliberately NO customer-facing SELECT policy on promo_codes:
-- the anon key ships in the browser bundle, and a readable code table is a
-- list of live discounts. Validation happens through /api/promo/validate.
-- ---------------------------------------------------------------------------
ALTER TABLE public.promo_codes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promo_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS promo_codes_admin_only ON public.promo_codes;
CREATE POLICY promo_codes_admin_only ON public.promo_codes
  FOR ALL TO authenticated USING (is_app_admin()) WITH CHECK (is_app_admin());

DROP POLICY IF EXISTS promo_redemptions_admin_only ON public.promo_redemptions;
CREATE POLICY promo_redemptions_admin_only ON public.promo_redemptions
  FOR ALL TO authenticated USING (is_app_admin()) WITH CHECK (is_app_admin());

-- Belt and braces: 0020/0021 changed the DEFAULT privileges for new tables, but
-- only for tables created by `postgres`. Re-assert explicitly so this migration
-- is correct even if applied by another role or before those defaults land.
REVOKE ALL ON public.promo_codes       FROM anon;
REVOKE ALL ON public.promo_redemptions FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.promo_codes       FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.promo_redemptions FROM authenticated;
