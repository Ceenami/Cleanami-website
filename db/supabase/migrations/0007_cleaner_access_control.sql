CREATE TYPE "public"."cleaner_invitation_status" AS ENUM('invited', 'signed_up', 'disabled');
CREATE TYPE "public"."cleaner_audit_action" AS ENUM(
  'invitation_created',
  'invitation_removed',
  'invitation_disabled',
  'signup_rejected',
  'signup_succeeded',
  'onboarding_started',
  'onboarding_completed',
  'stripe_onboarding_started',
  'stripe_onboarding_completed',
  'account_activated',
  'account_suspended',
  'account_reactivated'
);
CREATE TYPE "public"."cleaner_account_status" AS ENUM(
  'onboarding_in_progress',
  'stripe_pending',
  'active',
  'suspended'
);

CREATE TABLE "cleaner_invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL UNIQUE,
  "status" "cleaner_invitation_status" DEFAULT 'invited' NOT NULL,
  "invited_at" timestamp DEFAULT now() NOT NULL,
  "invited_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "signed_up_at" timestamp,
  "disabled_at" timestamp,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX "cleaner_invitations_email_idx" ON "cleaner_invitations" ("email");

CREATE TABLE "cleaner_signup_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "success" boolean DEFAULT false NOT NULL,
  "rejection_reason" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX "cleaner_signup_attempts_email_idx" ON "cleaner_signup_attempts" ("email");

CREATE TABLE "cleaner_audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "cleaner_id" uuid REFERENCES "cleaners"("id") ON DELETE SET NULL,
  "invitation_id" uuid REFERENCES "cleaner_invitations"("id") ON DELETE SET NULL,
  "action" "cleaner_audit_action" NOT NULL,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "metadata" jsonb DEFAULT '{}',
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX "cleaner_audit_logs_cleaner_idx" ON "cleaner_audit_logs" ("cleaner_id");
CREATE INDEX "cleaner_audit_logs_created_idx" ON "cleaner_audit_logs" ("created_at");

ALTER TABLE "cleaners"
  ADD COLUMN IF NOT EXISTS "onboarding_started" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "onboarding_started_at" timestamp,
  ADD COLUMN IF NOT EXISTS "onboarding_completed_at" timestamp,
  ADD COLUMN IF NOT EXISTS "stripe_charges_enabled" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "stripe_payouts_enabled" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "stripe_onboarding_completed_at" timestamp,
  ADD COLUMN IF NOT EXISTS "account_status" "cleaner_account_status" DEFAULT 'onboarding_in_progress' NOT NULL,
  ADD COLUMN IF NOT EXISTS "activated_at" timestamp,
  ADD COLUMN IF NOT EXISTS "invitation_id" uuid REFERENCES "cleaner_invitations"("id") ON DELETE SET NULL;

ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "portal_access_enabled" boolean DEFAULT false NOT NULL;

UPDATE "customers"
SET "portal_access_enabled" = true
WHERE "id" IN (
  SELECT DISTINCT "customer_id"
  FROM "subscriptions"
  WHERE "status" = 'active'
);
