ALTER TABLE "cleaners"
ADD COLUMN IF NOT EXISTS "eligible_for_assignments" boolean DEFAULT false NOT NULL;

-- Backfill: cleaners who already finished onboarding + Stripe payouts
UPDATE "cleaners"
SET "eligible_for_assignments" = true
WHERE "onboarding_completed" = true
  AND "stripe_payouts_enabled" = true;
