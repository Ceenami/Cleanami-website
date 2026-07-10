CREATE TABLE "onboarding_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"phone" text,
	"name" text,
	"current_step" integer DEFAULT 1 NOT NULL,
	"form_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"price_details" jsonb,
	"has_booked_call" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "onboarding_sessions_session_token_unique" UNIQUE("session_token")
);
--> statement-breakpoint
CREATE INDEX "onboarding_sessions_email_idx" ON "onboarding_sessions" USING btree ("email");--> statement-breakpoint
CREATE INDEX "onboarding_sessions_session_token_idx" ON "onboarding_sessions" USING btree ("session_token");--> statement-breakpoint
CREATE INDEX "onboarding_sessions_expires_at_idx" ON "onboarding_sessions" USING btree ("expires_at");