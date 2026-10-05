-- One real Stripe PaymentIntent may fund one job.
-- Run outside an explicit transaction.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "jobs_real_payment_intent_idx"
  ON "jobs" ("payment_intent_id")
  WHERE "payment_intent_id" LIKE 'pi\_%';

-- Preflight: resolve duplicates before applying this migration.
-- SELECT payment_intent_id, count(*)
-- FROM jobs
-- WHERE payment_intent_id LIKE 'pi\_%'
-- GROUP BY payment_intent_id
-- HAVING count(*) > 1;
