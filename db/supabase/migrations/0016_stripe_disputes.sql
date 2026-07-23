-- Task 1.23 — record Stripe chargebacks/disputes so the reserve rate can react.
-- Idempotent; hand-written in this repo's migration style (not drizzle-kit gen).

-- The webhook previously only appended a note on charge.dispute.*; there was no
-- structured record to compute the rolling 30-day dispute rate the spec's
-- reserve escalation (2% -> 5% when disputes exceed 0.5%) needs. This table is
-- the denominator source alongside reserve_transactions (captures).
CREATE TABLE IF NOT EXISTS "stripe_disputes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "stripe_dispute_id" text NOT NULL UNIQUE,
  "payment_intent_id" text,
  "job_id" uuid REFERENCES "jobs"("id") ON DELETE SET NULL,
  "amount_cents" integer,
  "reason" text,
  "status" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "stripe_disputes_created_idx"
  ON "stripe_disputes" ("created_at");
