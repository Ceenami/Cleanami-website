CREATE TYPE "public"."availability_submission_status" AS ENUM('on_time', 'late_accepted', 'late_warning');--> statement-breakpoint
CREATE TYPE "public"."cleaner_audit_action" AS ENUM('invitation_created', 'invitation_removed', 'invitation_disabled', 'signup_rejected', 'signup_succeeded', 'onboarding_started', 'onboarding_completed', 'stripe_onboarding_started', 'stripe_onboarding_completed', 'account_activated', 'account_suspended', 'account_reactivated');--> statement-breakpoint
CREATE TYPE "public"."cleaner_invitation_status" AS ENUM('invited', 'signed_up', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."cleaner_account_status" AS ENUM('onboarding_in_progress', 'stripe_pending', 'active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."dispute_status" AS ENUM('pending', 'resolved', 'denied');--> statement-breakpoint
CREATE TYPE "public"."dispute_type" AS ENUM('pay', 'reliability_score', 'job_assignment');--> statement-breakpoint
CREATE TYPE "public"."property_cleaner_tier" AS ENUM('main_primary', 'secondary_primary', 'preferred_backup', 'on_call');--> statement-breakpoint
ALTER TYPE "public"."job_status" ADD VALUE 'completed_pending_evidence' BEFORE 'completed';--> statement-breakpoint
ALTER TYPE "public"."job_status" ADD VALUE 'awaiting_capture' BEFORE 'completed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'swap_requested';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'dispute_update';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'assignment';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'availability_reminder';--> statement-breakpoint
CREATE TABLE "cleaner_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cleaner_id" uuid,
	"invitation_id" uuid,
	"action" "cleaner_audit_action" NOT NULL,
	"actor_user_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cleaner_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"status" "cleaner_invitation_status" DEFAULT 'invited' NOT NULL,
	"invited_at" timestamp DEFAULT now() NOT NULL,
	"invited_by" uuid,
	"signed_up_at" timestamp,
	"disabled_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cleaner_invitations_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "cleaner_signup_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"success" boolean DEFAULT false NOT NULL,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stripe_dispute_id" text NOT NULL,
	"payment_intent_id" text,
	"job_id" uuid,
	"amount_cents" integer,
	"reason" text,
	"status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_disputes_stripe_dispute_id_unique" UNIQUE("stripe_dispute_id")
);
--> statement-breakpoint
CREATE TABLE "platform_config" (
	"key" text PRIMARY KEY NOT NULL,
	"int_value" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"discount_type" text NOT NULL,
	"discount_value" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"max_redemptions" integer,
	"redemption_count" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promo_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "promo_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promo_code_id" uuid NOT NULL,
	"code" text NOT NULL,
	"customer_email" text NOT NULL,
	"customer_id" uuid,
	"subscription_id" uuid,
	"job_id" uuid,
	"payment_intent_id" text NOT NULL,
	"original_amount_cents" integer NOT NULL,
	"discount_amount_cents" integer NOT NULL,
	"final_amount_cents" integer NOT NULL,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promo_redemptions_payment_intent_id_unique" UNIQUE("payment_intent_id")
);
--> statement-breakpoint
CREATE TABLE "restock_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"property_id" uuid NOT NULL,
	"cleaner_id" uuid,
	"item" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"urgency" text DEFAULT 'normal' NOT NULL,
	"notes" text,
	"status" text DEFAULT 'requested' NOT NULL,
	"admin_notes" text,
	"resolved_by_user_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cleaner_id" uuid NOT NULL,
	"type" "dispute_type" NOT NULL,
	"description" text NOT NULL,
	"status" "dispute_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property_cleaners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"cleaner_id" uuid NOT NULL,
	"tier" "property_cleaner_tier" NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"cleaner_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"stars" integer NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ratings_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "processed_stripe_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"processed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evidence_packets" DROP CONSTRAINT "evidence_packets_job_id_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "checklist_files" ALTER COLUMN "storage_path" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "availability" ADD COLUMN "submission_status" "availability_submission_status" DEFAULT 'on_time' NOT NULL;--> statement-breakpoint
ALTER TABLE "checklist_files" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "cleaners" ADD COLUMN "has_laundry_lead_cert" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cleaners" ADD COLUMN "stripe_charges_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cleaners" ADD COLUMN "stripe_payouts_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cleaners" ADD COLUMN "stripe_onboarding_completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "cleaners" ADD COLUMN "account_status" "cleaner_account_status" DEFAULT 'onboarding_in_progress' NOT NULL;--> statement-breakpoint
ALTER TABLE "cleaners" ADD COLUMN "invitation_id" uuid;--> statement-breakpoint
ALTER TABLE "cleaners" ADD COLUMN "onboarding_started" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cleaners" ADD COLUMN "onboarding_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "cleaners" ADD COLUMN "onboarding_completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "cleaners" ADD COLUMN "activated_at" timestamp;--> statement-breakpoint
ALTER TABLE "cleaners" ADD COLUMN "eligible_for_assignments" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cleaners" ADD COLUMN "availability_late_override_period_start" date;--> statement-breakpoint
ALTER TABLE "cleaners" ADD COLUMN "hourly_rate_cents" integer DEFAULT 1700 NOT NULL;--> statement-breakpoint
ALTER TABLE "cleaners" ADD COLUMN "hire_date" date;--> statement-breakpoint
ALTER TABLE "cleaners" ADD COLUMN "rate_reviewed_at" date;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "skip_payment" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "portal_access_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "anonymized_at" timestamp;--> statement-breakpoint
ALTER TABLE "evidence_packets" ADD COLUMN "check_in_latitude" numeric(10, 8);--> statement-breakpoint
ALTER TABLE "evidence_packets" ADD COLUMN "check_in_longitude" numeric(11, 8);--> statement-breakpoint
ALTER TABLE "evidence_packets" ADD COLUMN "check_in_accuracy_meters" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "evidence_packets" ADD COLUMN "check_in_distance_miles" numeric(8, 3);--> statement-breakpoint
ALTER TABLE "evidence_packets" ADD COLUMN "check_in_within_geofence" boolean;--> statement-breakpoint
ALTER TABLE "evidence_packets" ADD COLUMN "check_in_override_reason" text;--> statement-breakpoint
ALTER TABLE "evidence_packets" ADD COLUMN "check_in_override_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "evidence_packets" ADD COLUMN "check_out_latitude" numeric(10, 8);--> statement-breakpoint
ALTER TABLE "evidence_packets" ADD COLUMN "check_out_longitude" numeric(11, 8);--> statement-breakpoint
ALTER TABLE "evidence_packets" ADD COLUMN "check_out_accuracy_meters" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "evidence_packets" ADD COLUMN "check_out_distance_miles" numeric(8, 3);--> statement-breakpoint
ALTER TABLE "evidence_packets" ADD COLUMN "check_out_within_geofence" boolean;--> statement-breakpoint
ALTER TABLE "evidence_packets" ADD COLUMN "arrival_delay_minutes" integer;--> statement-breakpoint
ALTER TABLE "evidence_packets" ADD COLUMN "arrival_on_time" boolean;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "promo_code_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs_to_cleaners" ADD COLUMN "is_team_leader" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "late_deduction_amount" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "processing_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "geofence_radius_meters" integer;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "price_override_cents" integer;--> statement-breakpoint
ALTER TABLE "swap_requests" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "onboarding_documents" ADD COLUMN "signed_name" text;--> statement-breakpoint
ALTER TABLE "cleaner_audit_logs" ADD CONSTRAINT "cleaner_audit_logs_cleaner_id_cleaners_id_fk" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cleaner_audit_logs" ADD CONSTRAINT "cleaner_audit_logs_invitation_id_cleaner_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."cleaner_invitations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cleaner_audit_logs" ADD CONSTRAINT "cleaner_audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cleaner_invitations" ADD CONSTRAINT "cleaner_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_disputes" ADD CONSTRAINT "stripe_disputes_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_promo_code_id_promo_codes_id_fk" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_codes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restock_requests" ADD CONSTRAINT "restock_requests_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restock_requests" ADD CONSTRAINT "restock_requests_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restock_requests" ADD CONSTRAINT "restock_requests_cleaner_id_cleaners_id_fk" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restock_requests" ADD CONSTRAINT "restock_requests_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_cleaner_id_cleaners_id_fk" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_cleaners" ADD CONSTRAINT "property_cleaners_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_cleaners" ADD CONSTRAINT "property_cleaners_cleaner_id_cleaners_id_fk" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_cleaner_id_cleaners_id_fk" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cleaner_audit_logs_cleaner_idx" ON "cleaner_audit_logs" USING btree ("cleaner_id");--> statement-breakpoint
CREATE INDEX "cleaner_audit_logs_created_idx" ON "cleaner_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "cleaner_invitations_email_idx" ON "cleaner_invitations" USING btree ("email");--> statement-breakpoint
CREATE INDEX "cleaner_signup_attempts_email_idx" ON "cleaner_signup_attempts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "stripe_disputes_created_idx" ON "stripe_disputes" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "promo_redemptions_code_idx" ON "promo_redemptions" USING btree ("promo_code_id");--> statement-breakpoint
CREATE INDEX "restock_requests_status_idx" ON "restock_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "restock_requests_property_idx" ON "restock_requests" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "restock_requests_cleaner_idx" ON "restock_requests" USING btree ("cleaner_id");--> statement-breakpoint
CREATE INDEX "disputes_cleaner_idx" ON "disputes" USING btree ("cleaner_id");--> statement-breakpoint
CREATE INDEX "disputes_status_idx" ON "disputes" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "property_cleaners_property_cleaner_unique" ON "property_cleaners" USING btree ("property_id","cleaner_id");--> statement-breakpoint
CREATE INDEX "property_cleaners_property_idx" ON "property_cleaners" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "property_cleaners_cleaner_idx" ON "property_cleaners" USING btree ("cleaner_id");--> statement-breakpoint
CREATE INDEX "ratings_cleaner_idx" ON "ratings" USING btree ("cleaner_id");--> statement-breakpoint
CREATE INDEX "ratings_customer_idx" ON "ratings" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "processed_stripe_events_event_id_key" ON "processed_stripe_events" USING btree ("event_id");--> statement-breakpoint
ALTER TABLE "cleaners" ADD CONSTRAINT "cleaners_invitation_id_cleaner_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."cleaner_invitations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_packets" ADD CONSTRAINT "evidence_packets_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_promo_code_id_promo_codes_id_fk" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_job_cleaner_key" ON "payouts" USING btree ("job_id","cleaner_id");--> statement-breakpoint
ALTER TABLE "reserve_transactions" ADD CONSTRAINT "reserve_transactions_job_id_unique" UNIQUE("job_id");