-- Part A/B/C UI test data (safe to delete — all rows tagged part-abc-test)
-- Run in Supabase SQL editor against project hwtrpjkjhojvezdfcbkm
-- Customer: cleannami@ceenami.com (customer_id below)

-- ========== CLEANUP (run this when finished) ==========
-- DELETE FROM jobs_to_cleaners WHERE job_id IN (SELECT id FROM jobs WHERE calendar_event_uid LIKE 'part-abc-test-%');
-- DELETE FROM payouts WHERE job_id IN (SELECT id FROM jobs WHERE calendar_event_uid LIKE 'part-abc-test-%');
-- DELETE FROM jobs WHERE calendar_event_uid LIKE 'part-abc-test-%';
-- DELETE FROM subscriptions WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
-- DELETE FROM properties WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';

-- ========== SEED ==========
-- Duplicate property (Part B merge test)
INSERT INTO properties (
  id, customer_id, address, bed_count, bath_count, laundry_type, has_hot_tub,
  hot_tub_service, needs_drain, use_default_check_lict
) VALUES (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
  '1357468b-cdd6-4a65-af9a-2b17c4ebfd8a',
  '999 PART-ABC Duplicate Orange Tree Ln, Edgewater, FL',
  3, 2, 'in_unit', false, false, false, false
) ON CONFLICT (id) DO NOTHING;

-- First-month subscription (Part C — subscription cancel should be blocked)
INSERT INTO subscriptions (
  id, customer_id, property_id, duration_months, status,
  start_date, end_date, is_first_clean_prepaid
) VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  '1357468b-cdd6-4a65-af9a-2b17c4ebfd8a',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
  3, 'active',
  CURRENT_DATE - 5,
  CURRENT_DATE + 85,
  false
) ON CONFLICT (id) DO NOTHING;

-- On-time cancel job (+3 days, no cleaner) — Part C
INSERT INTO jobs (
  id, subscription_id, property_id, status,
  check_in_time, check_out_time, calendar_event_uid, expected_hours
) VALUES (
  'cccccccc-cccc-cccc-cccc-ccccccccccc1',
  '3839c769-d41a-48b1-832e-820c7a3675d4',
  'cb58d145-40b8-4163-b695-2cd42d97857f',
  'unassigned',
  NOW() + INTERVAL '3 days',
  NOW() + INTERVAL '3 days' + INTERVAL '7 hours',
  'part-abc-test-ontime-1',
  '2.50'
) ON CONFLICT (id) DO NOTHING;

-- Late cancel job (+8 hours, cleaner assigned) — Part C
INSERT INTO jobs (
  id, subscription_id, property_id, status,
  check_in_time, check_out_time, calendar_event_uid, expected_hours
) VALUES (
  'cccccccc-cccc-cccc-cccc-ccccccccccc2',
  '3839c769-d41a-48b1-832e-820c7a3675d4',
  'cb58d145-40b8-4163-b695-2cd42d97857f',
  'assigned',
  NOW() + INTERVAL '8 hours',
  NOW() + INTERVAL '8 hours' + INTERVAL '7 hours',
  'part-abc-test-late-1',
  '2.50'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO jobs_to_cleaners (job_id, cleaner_id, role)
VALUES (
  'cccccccc-cccc-cccc-cccc-ccccccccccc2',
  '17c63713-2f30-44f9-8ecd-397beefbdc3a',
  'primary'
) ON CONFLICT DO NOTHING;

-- First-month individual clean (+2 days) — Part C (cancel allowed even in month 1)
INSERT INTO jobs (
  id, subscription_id, property_id, status,
  check_in_time, check_out_time, calendar_event_uid, expected_hours
) VALUES (
  'cccccccc-cccc-cccc-cccc-ccccccccccc3',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
  'unassigned',
  NOW() + INTERVAL '2 days',
  NOW() + INTERVAL '2 days' + INTERVAL '7 hours',
  'part-abc-test-firstmonth-clean-1',
  '2.00'
) ON CONFLICT (id) DO NOTHING;
