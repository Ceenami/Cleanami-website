-- Task 1.9 — admin per-property pricing override.
-- Idempotent; hand-written in this repo's migration style (not drizzle-kit gen).

-- Optional admin-set flat price per clean (cents) for a specific property. When
-- present it overrides the calculated price on every charge path (booking
-- re-check, recurring pre-authorize, one-off), bypassing the term discount.
ALTER TABLE "properties"
  ADD COLUMN IF NOT EXISTS "price_override_cents" integer;
