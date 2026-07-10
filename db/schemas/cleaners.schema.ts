
import { pgTable, uuid, timestamp, text, integer, boolean, numeric, jsonb, index, pgEnum, date } from "drizzle-orm/pg-core";
import { users } from "./users.schema";
import { cleanerInvitations } from "./cleanerInvitations.schema";

// Enum for on-call status as requested
export const onCallStatusEnum = pgEnum('on_call_status', ['available', 'unavailable', 'on_job']);

export const cleanerAccountStatusEnum = pgEnum('cleaner_account_status', [
  'onboarding_in_progress',
  'stripe_pending',
  'active',
  'suspended',
]);

export const cleaners = pgTable("cleaners", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: 'cascade' }).unique(),
  fullName: text("full_name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone_number"),
  address: text("address"),
  travelRadiusMiles: integer("travel_radius_miles").default(25),
  profilePhotoUrl: text("profile_photo_url"),
  experienceYears: integer("experience_years"),
  hasHotTubCert: boolean("has_hot_tub_cert").default(false),
  reliabilityScore: numeric("reliability_score", { precision: 5, scale: 2 }), 
  onCallStatus: onCallStatusEnum("on_call_status").default('unavailable'),
  stripeAccountId: text("stripe_account_id").unique(),
  stripeOnboardingComplete: boolean("stripe_onboarding_complete").default(false),
  stripeChargesEnabled: boolean("stripe_charges_enabled").default(false).notNull(),
  stripePayoutsEnabled: boolean("stripe_payouts_enabled").default(false).notNull(),
  stripeOnboardingCompletedAt: timestamp("stripe_onboarding_completed_at"),
  accountStatus: cleanerAccountStatusEnum("account_status").default('onboarding_in_progress').notNull(),
  invitationId: uuid("invitation_id").references(() => cleanerInvitations.id, { onDelete: 'set null' }),
  onboardingStarted: boolean("onboarding_started").default(false).notNull(),
  onboardingStartedAt: timestamp("onboarding_started_at"),
  onboardingCompleted: boolean("onboarding_completed").default(false),
  onboardingCompletedAt: timestamp("onboarding_completed_at"),
  activatedAt: timestamp("activated_at"),
  latitude: numeric("latitude", { precision: 10, scale: 8 }),
  longitude: numeric("longitude", { precision: 11, scale: 8 }),
  geocodedAt: timestamp("geocoded_at"),
  legalDocsSigned: jsonb("legal_docs_signed").$type<{
    w9Url: string | null;
    liabilityWaiverUrl: string | null;
    gpsConsentUrl: string | null;
    contractorAgreementUrl?: string | null;
  }>().default({ w9Url: null, liabilityWaiverUrl: null, gpsConsentUrl: null }),
  onboardingStep: integer("onboarding_step").default(1),
  /** Admin-controlled + auto-enabled when onboarding + Stripe payouts are complete */
  eligibleForAssignments: boolean("eligible_for_assignments").default(false).notNull(),
  /** Period start (Monday) for which the one-time late catch-up override was consumed */
  availabilityLateOverridePeriodStart: date("availability_late_override_period_start"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  // Index for job assignment engine ranking
  index("cleaners_reliability_idx").on(table.reliabilityScore),
  index("cleaners_location_idx").on(table.latitude, table.longitude),
]);

