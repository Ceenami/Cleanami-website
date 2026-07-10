CREATE TYPE "public"."availability_type" AS ENUM('vacation_rental', 'residential');--> statement-breakpoint
CREATE TYPE "public"."on_call_status" AS ENUM('available', 'unavailable', 'on_job');--> statement-breakpoint
CREATE TYPE "public"."evidence_packet_status" AS ENUM('complete', 'incomplete', 'pending_review');--> statement-breakpoint
CREATE TYPE "public"."job_cleaner_role" AS ENUM('primary', 'backup', 'on-call', 'laundry_lead');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('unassigned', 'assigned', 'in-progress', 'completed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'authorized', 'captured', 'failed', 'capture_failed');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('pending', 'released', 'held');--> statement-breakpoint
CREATE TYPE "public"."swap_request_status" AS ENUM('pending', 'accepted', 'expired', 'cancelled', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('w9', 'contractor_agreement', 'liability_waiver', 'privacy_consent');--> statement-breakpoint
CREATE TYPE "public"."activity_type" AS ENUM('arrival', 'working', 'departure');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('job_reminder', 'photo_reminder', 'completion_reminder', 'urgent_job', 'payment_ready', 'reliability_check', 'swap_available');--> statement-breakpoint
CREATE TYPE "public"."reliability_event_type" AS ENUM('late_arrival', 'no_show', 'call_out', 'on_time', 'early_arrival');--> statement-breakpoint
CREATE TYPE "public"."expected_lateness" AS ENUM('on_time', 'under_10', 'under_30', 'hour_plus');--> statement-breakpoint
CREATE TYPE "public"."badge_category" AS ENUM('reliability', 'performance', 'specialization', 'achievement');--> statement-breakpoint
CREATE TABLE "availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cleaner_id" uuid NOT NULL,
	"date" date NOT NULL,
	"availability_type" "availability_type" NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"on_call_eligible" boolean DEFAULT false,
	"open_pool_eligible" boolean DEFAULT false,
	"is_grace_period" boolean DEFAULT false,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checklist_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"storage_path" text NOT NULL,
	"file_size" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_files_storage_path_unique" UNIQUE("storage_path")
);
--> statement-breakpoint
CREATE TABLE "cleaners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"phone_number" text,
	"address" text,
	"travel_radius_miles" integer DEFAULT 25,
	"profile_photo_url" text,
	"experience_years" integer,
	"has_hot_tub_cert" boolean DEFAULT false,
	"reliability_score" numeric(5, 2),
	"on_call_status" "on_call_status" DEFAULT 'unavailable',
	"stripe_account_id" text,
	"stripe_onboarding_complete" boolean DEFAULT false,
	"latitude" numeric(10, 8),
	"longitude" numeric(11, 8),
	"geocoded_at" timestamp,
	"legal_docs_signed" jsonb DEFAULT '{"w9Url":null,"liabilityWaiverUrl":null,"gpsConsentUrl":null}'::jsonb,
	"onboarding_completed" boolean DEFAULT false,
	"onboarding_step" integer DEFAULT 1,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cleaners_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "cleaners_email_unique" UNIQUE("email"),
	CONSTRAINT "cleaners_stripe_account_id_unique" UNIQUE("stripe_account_id")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone_number" text,
	"stripe_customer_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "customers_email_unique" UNIQUE("email"),
	CONSTRAINT "customers_stripe_customer_id_unique" UNIQUE("stripe_customer_id")
);
--> statement-breakpoint
CREATE TABLE "evidence_packets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"photo_urls" text[],
	"is_checklist_complete" boolean DEFAULT false,
	"checklist_log" jsonb,
	"gps_check_in_timestamp" timestamp with time zone,
	"gps_check_out_timestamp" timestamp with time zone,
	"cleaner_notes" text,
	"status" "evidence_packet_status" DEFAULT 'pending_review',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_packets_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid,
	"property_id" uuid,
	"status" "job_status" DEFAULT 'unassigned',
	"check_in_time" timestamp with time zone,
	"check_out_time" timestamp with time zone,
	"calendar_event_uid" text NOT NULL,
	"expected_hours" numeric(4, 2),
	"addons_snapshot" jsonb,
	"payment_intent_id" text,
	"payment_status" "payment_status",
	"payment_failed" boolean DEFAULT false,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs_to_cleaners" (
	"job_id" uuid NOT NULL,
	"cleaner_id" uuid NOT NULL,
	"role" "job_cleaner_role" NOT NULL,
	"urgent_bonus" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_to_cleaners_job_id_cleaner_id_pk" PRIMARY KEY("job_id","cleaner_id")
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"cleaner_id" uuid NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"urgent_bonus_amount" numeric(10, 2),
	"laundry_bonus_amount" numeric(10, 2),
	"stripe_payout_id" text,
	"status" "payout_status" DEFAULT 'pending',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payouts_stripe_payout_id_unique" UNIQUE("stripe_payout_id")
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"address" text NOT NULL,
	"sq_ft" integer,
	"bed_count" integer NOT NULL,
	"bath_count" numeric(3, 1) NOT NULL,
	"has_hot_tub" boolean DEFAULT false NOT NULL,
	"laundry_type" varchar NOT NULL,
	"laundry_loads" integer,
	"hot_tub_service" boolean DEFAULT false NOT NULL,
	"needs_drain" boolean DEFAULT false NOT NULL,
	"hot_tub_drain_cadence" varchar,
	"use_default_check_lict" boolean DEFAULT false NOT NULL,
	"latitude" numeric(10, 8),
	"longitude" numeric(11, 8),
	"geocoded_at" timestamp,
	"ical_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"stripe_subscription_id" text,
	"duration_months" integer NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"first_clean_payment_id" text,
	"is_first_clean_prepaid" boolean DEFAULT false NOT NULL,
	"ical_sync_failed" boolean DEFAULT false,
	"last_sync_attempt" timestamp,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id"),
	CONSTRAINT "subscriptions_first_clean_payment_id_unique" UNIQUE("first_clean_payment_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supabase_user_id" uuid NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_supabase_user_id_unique" UNIQUE("supabase_user_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "base_pricing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bedrooms" integer NOT NULL,
	"price_1_bath_cents" integer NOT NULL,
	"price_2_bath_cents" integer NOT NULL,
	"price_3_bath_cents" integer NOT NULL,
	"price_4_bath_cents" integer NOT NULL,
	"price_5_bath_cents" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "base_pricing_rules_bedrooms_unique" UNIQUE("bedrooms")
);
--> statement-breakpoint
CREATE TABLE "hot_tub_pricing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_type" varchar NOT NULL,
	"customer_revenue_cents" integer NOT NULL,
	"time_add_hours" numeric(4, 3) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hot_tub_pricing_rules_service_type_unique" UNIQUE("service_type")
);
--> statement-breakpoint
CREATE TABLE "laundry_pricing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_type" varchar NOT NULL,
	"customer_revenue_base_cents" integer NOT NULL,
	"customer_revenue_per_load_cents" integer NOT NULL,
	"cleaner_bonus_per_load_cents" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "laundry_pricing_rules_service_type_unique" UNIQUE("service_type")
);
--> statement-breakpoint
CREATE TABLE "pricing_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_url" text NOT NULL,
	"status" varchar DEFAULT 'processing' NOT NULL,
	"notes" text,
	"uploaded_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sqft_surcharge_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"range_start" integer NOT NULL,
	"range_end" integer NOT NULL,
	"surcharge_cents" integer NOT NULL,
	"is_custom_quote" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reserve_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"payment_intent_id" text NOT NULL,
	"total_amount_cents" integer NOT NULL,
	"reserve_amount_cents" integer NOT NULL,
	"net_amount_cents" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swap_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"original_cleaner_id" uuid NOT NULL,
	"replacement_cleaner_id" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "swap_request_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cleaner_id" uuid NOT NULL,
	"document_type" "document_type" NOT NULL,
	"signed" boolean DEFAULT false NOT NULL,
	"signed_at" timestamp with time zone,
	"document_url" text,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_documents_cleaner_id_document_type_unique" UNIQUE("cleaner_id","document_type")
);
--> statement-breakpoint
CREATE TABLE "capability_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cleaner_id" uuid NOT NULL,
	"hot_tub_capable" boolean DEFAULT false NOT NULL,
	"laundry_lead_eligible" boolean DEFAULT false NOT NULL,
	"team_leader_eligible" boolean DEFAULT false NOT NULL,
	"owns_vehicle" boolean DEFAULT false NOT NULL,
	"background_check_passed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capability_flags_cleaner_unique" UNIQUE("cleaner_id")
);
--> statement-breakpoint
CREATE TABLE "gps_tracking_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"cleaner_id" uuid NOT NULL,
	"latitude" numeric(10, 8) NOT NULL,
	"longitude" numeric(11, 8) NOT NULL,
	"accuracy" numeric(8, 2),
	"activity_type" "activity_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"job_id" uuid,
	"is_read" boolean DEFAULT false NOT NULL,
	"scheduled_for" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "reliability_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cleaner_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"event_type" "reliability_event_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"penalty_points" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reliability_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"cleaner_id" uuid NOT NULL,
	"notification_sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"response_received_at" timestamp with time zone,
	"expected_lateness" "expected_lateness",
	"actual_arrival_delay_minutes" integer,
	"manual_checkin_at" timestamp with time zone,
	"gps_arrival_at" timestamp with time zone,
	"manual_checkout_at" timestamp with time zone,
	"gps_departure_at" timestamp with time zone,
	"job_cancelled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "badges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"icon" text NOT NULL,
	"category" "badge_category" NOT NULL,
	"requirements" jsonb NOT NULL,
	"points_value" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "badges_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "cleaner_badges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cleaner_id" uuid NOT NULL,
	"badge_id" uuid NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"progress" jsonb DEFAULT '{}'::jsonb,
	CONSTRAINT "cleaner_badges_cleaner_badge_unique" UNIQUE("cleaner_id","badge_id")
);
--> statement-breakpoint
CREATE TABLE "job_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cleaner_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"completed_at" timestamp with time zone,
	"rating" integer,
	"has_hot_tub" boolean DEFAULT false NOT NULL,
	"is_team_leader" boolean DEFAULT false NOT NULL,
	"is_laundry_lead" boolean DEFAULT false NOT NULL,
	"is_on_call" boolean DEFAULT false NOT NULL,
	"bonus_earned_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_stats_cleaner_job_unique" UNIQUE("cleaner_id","job_id")
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cleaner_id" uuid NOT NULL,
	"push_notifications_enabled" boolean DEFAULT true NOT NULL,
	"on_call_alerts_enabled" boolean DEFAULT false NOT NULL,
	"email_notifications_enabled" boolean DEFAULT true NOT NULL,
	"sms_notifications_enabled" boolean DEFAULT false NOT NULL,
	"location_tracking_enabled" boolean DEFAULT true NOT NULL,
	"auto_photo_upload_enabled" boolean DEFAULT false NOT NULL,
	"share_location_with_team" boolean DEFAULT false NOT NULL,
	"preferred_language" text DEFAULT 'en' NOT NULL,
	"preferred_region" text DEFAULT 'US' NOT NULL,
	"theme" text DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_preferences_cleaner_id_unique" UNIQUE("cleaner_id")
);
--> statement-breakpoint
CREATE TABLE "push_notification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cleaner_id" uuid NOT NULL,
	"token" text NOT NULL,
	"device_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_notification_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "availability" ADD CONSTRAINT "availability_cleaner_id_cleaners_id_fk" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_files" ADD CONSTRAINT "checklist_files_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cleaners" ADD CONSTRAINT "cleaners_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_packets" ADD CONSTRAINT "evidence_packets_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs_to_cleaners" ADD CONSTRAINT "jobs_to_cleaners_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs_to_cleaners" ADD CONSTRAINT "jobs_to_cleaners_cleaner_id_cleaners_id_fk" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_cleaner_id_cleaners_id_fk" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_uploads" ADD CONSTRAINT "pricing_uploads_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserve_transactions" ADD CONSTRAINT "reserve_transactions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_original_cleaner_id_cleaners_id_fk" FOREIGN KEY ("original_cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_replacement_cleaner_id_cleaners_id_fk" FOREIGN KEY ("replacement_cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_documents" ADD CONSTRAINT "onboarding_documents_cleaner_id_cleaners_id_fk" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_flags" ADD CONSTRAINT "capability_flags_cleaner_id_cleaners_id_fk" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gps_tracking_logs" ADD CONSTRAINT "gps_tracking_logs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gps_tracking_logs" ADD CONSTRAINT "gps_tracking_logs_cleaner_id_cleaners_id_fk" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reliability_events" ADD CONSTRAINT "reliability_events_cleaner_id_cleaners_id_fk" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reliability_events" ADD CONSTRAINT "reliability_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reliability_checks" ADD CONSTRAINT "reliability_checks_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reliability_checks" ADD CONSTRAINT "reliability_checks_cleaner_id_cleaners_id_fk" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cleaner_badges" ADD CONSTRAINT "cleaner_badges_cleaner_id_cleaners_id_fk" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cleaner_badges" ADD CONSTRAINT "cleaner_badges_badge_id_badges_id_fk" FOREIGN KEY ("badge_id") REFERENCES "public"."badges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_stats" ADD CONSTRAINT "job_stats_cleaner_id_cleaners_id_fk" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_stats" ADD CONSTRAINT "job_stats_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_cleaner_id_cleaners_id_fk" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_notification_tokens" ADD CONSTRAINT "push_notification_tokens_cleaner_id_cleaners_id_fk" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "availability_date_cleaner_idx" ON "availability" USING btree ("date","cleaner_id");--> statement-breakpoint
CREATE INDEX "cleaners_reliability_idx" ON "cleaners" USING btree ("reliability_score");--> statement-breakpoint
CREATE INDEX "cleaners_location_idx" ON "cleaners" USING btree ("latitude","longitude");--> statement-breakpoint
CREATE INDEX "customers_email_idx" ON "customers" USING btree ("email");--> statement-breakpoint
CREATE INDEX "customers_stripe_idx" ON "customers" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "evidence_packets_status_idx" ON "evidence_packets" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_event_uid_idx" ON "jobs" USING btree ("calendar_event_uid");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "properties_customer_idx" ON "properties" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "properties_location_idx" ON "properties" USING btree ("latitude","longitude");--> statement-breakpoint
CREATE INDEX "subscriptions_customer_idx" ON "subscriptions" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "subscriptions_property_idx" ON "subscriptions" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_name_idx" ON "users" USING btree ("name");--> statement-breakpoint
CREATE INDEX "swap_requests_job_idx" ON "swap_requests" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "swap_requests_original_cleaner_idx" ON "swap_requests" USING btree ("original_cleaner_id");--> statement-breakpoint
CREATE INDEX "swap_requests_status_idx" ON "swap_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "gps_tracking_logs_job_cleaner_idx" ON "gps_tracking_logs" USING btree ("job_id","cleaner_id");--> statement-breakpoint
CREATE INDEX "gps_tracking_logs_created_at_idx" ON "gps_tracking_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_scheduled_idx" ON "notifications" USING btree ("user_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "notifications_type_job_idx" ON "notifications" USING btree ("type","job_id");--> statement-breakpoint
CREATE INDEX "idx_user_preferences_cleaner_id" ON "user_preferences" USING btree ("cleaner_id");--> statement-breakpoint
CREATE INDEX "push_tokens_cleaner_idx" ON "push_notification_tokens" USING btree ("cleaner_id");