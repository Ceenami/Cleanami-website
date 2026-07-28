-- 0027 — promo codes on recurring cleans, one-per-customer-ever (client
-- feedback round 2, notes #10-11: customer-entered codes, no per-customer
-- reuse, and a code discounts exactly one clean — never a recurring
-- discount, which stays exclusive to the subscription-term-length discount).
-- Idempotent (safe to re-run) to match this repo's hand-applied migration
-- style. Hand-written; NOT produced by `drizzle-kit generate`.
--
-- PRE-FLIGHT (run before this file, since the unique index below will fail
-- outright if violated): confirm there are no existing duplicate
-- (promo_code_id, lower(customer_email)) rows in promo_redemptions.
--   SELECT promo_code_id, lower(customer_email), COUNT(*)
--   FROM promo_redemptions
--   GROUP BY 1, 2
--   HAVING COUNT(*) > 1;
-- Expected: zero rows (the promo feature is brand new, migration 0022).

-- The code applied to THIS job's still-unauthorized recurring charge. Set by
-- the customer through the portal, read (and cleared-on-failure-is-NOT-done,
-- see below) by the pre-authorize cron. Left in place after redemption as an
-- audit trail — harmless, since the cron only ever selects jobs where
-- payment_intent_id IS NULL.
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS promo_code_id uuid REFERENCES promo_codes(id) ON DELETE SET NULL;

-- Audit link from a redemption back to the specific recurring clean it
-- discounted. NULL for first-clean (booking checkout) redemptions.
ALTER TABLE promo_redemptions
  ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES jobs(id) ON DELETE SET NULL;

-- Once per customer per code, EVER — across both the first-clean checkout
-- flow and this new recurring-clean flow, since both write into this table.
-- Keyed on customer_email (not customer_id): at checkout-preview time, no
-- customer row exists yet, so customer_id isn't always known, while email is
-- always present (see the pre-existing promo_redemptions_email_idx).
CREATE UNIQUE INDEX IF NOT EXISTS promo_redemptions_code_customer_once_idx
  ON promo_redemptions (promo_code_id, lower(customer_email));

-- At most one *pending* (not-yet-authorized) job may hold a given code at a
-- time. This is the race-free backstop against a customer parking the same
-- not-yet-burned code on two different upcoming jobs before either actually
-- charges (the redemption row above, which is the real once-ever guard, is
-- only written once the pre-authorize cron actually creates the PaymentIntent
-- — up to ~24h after the customer applies the code).
CREATE UNIQUE INDEX IF NOT EXISTS jobs_promo_unauthorized_once_idx
  ON jobs (promo_code_id)
  WHERE promo_code_id IS NOT NULL AND payment_intent_id IS NULL;
