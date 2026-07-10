-- Orange Tree owner portal: cleannami@ceenami.com
-- Run in Supabase SQL editor or: psql $DATABASE_URL -f scripts/verify-orange-tree-owner.sql

-- 1) Customer row linked to founder email with billing bypass
SELECT
  c.id AS customer_id,
  c.email,
  c.name,
  c.skip_payment,
  p.id AS property_id,
  p.address,
  s.id AS subscription_id,
  s.status AS subscription_status
FROM customers c
JOIN properties p ON p.customer_id = c.id
LEFT JOIN subscriptions s ON s.property_id = p.id
WHERE c.email = 'cleannami@ceenami.com'
  AND p.address ILIKE '%1510 Orange Tree%';

-- Expected: one row, skip_payment = true, active subscription

-- 2) Auth user role (still super_admin; owner portal uses customers.email match)
SELECT email, raw_user_meta_data->>'role' AS auth_role
FROM auth.users
WHERE email = 'cleannami@ceenami.com';

-- 3) Upcoming jobs for Orange Tree (payment should stay null until pre-auth cron)
SELECT
  j.id,
  j.status,
  j.check_out_time,
  j.payment_status,
  j.payment_intent_id,
  c.email,
  c.skip_payment
FROM jobs j
JOIN subscriptions s ON s.id = j.subscription_id
JOIN customers c ON c.id = s.customer_id
JOIN properties p ON p.id = j.property_id
WHERE c.email = 'cleannami@ceenami.com'
ORDER BY j.check_out_time ASC NULLS LAST
LIMIT 10;

-- After pre-auth cron runs for a job with checkout tomorrow:
--   payment_intent_id = 'skipped_owner_payment'
--   payment_status = 'authorized'
-- (no Stripe charge)
