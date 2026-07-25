-- Task 1.9 — admin-configurable platform settings (first-clean discount).
-- Idempotent; hand-written in this repo's migration style (not drizzle-kit gen).

-- Small key→int config store, Drizzle-owned (distinct from the dashboard-managed
-- app_settings table). Seeds the first-clean discount at 0% until an admin sets it.
CREATE TABLE IF NOT EXISTS "platform_config" (
  "key" text PRIMARY KEY,
  "int_value" integer,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

INSERT INTO "platform_config" ("key", "int_value")
  VALUES ('first_clean_discount_percent', 0)
  ON CONFLICT ("key") DO NOTHING;
