-- 0048 — a Stripe PaymentIntent can fund one job, never two.
--
-- A browser can replay a completion request after a lost response. Application
-- checks make that ordinary retry harmless, while this partial unique index is
-- the database backstop for concurrent requests. Billing-skip sentinels are
-- deliberately reused and are therefore excluded; Stripe PaymentIntent ids
-- start with pi_.

-- `CONCURRENTLY` keeps this from blocking new bookings while the live index is
-- built. Do not wrap this migration in an explicit transaction.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "jobs_real_payment_intent_idx"
  ON "jobs" ("payment_intent_id")
  WHERE "payment_intent_id" LIKE 'pi\_%';

-- Preflight before applying to production. This must return no rows; resolve a
-- duplicate manually rather than guessing which historical job is valid.
-- SELECT payment_intent_id, count(*)
-- FROM jobs
-- WHERE payment_intent_id LIKE 'pi\_%'
-- GROUP BY payment_intent_id
-- HAVING count(*) > 1;
