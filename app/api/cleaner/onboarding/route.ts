import { NextRequest, NextResponse } from "next/server";
import {
  cleanerAuthErrorStatus,
  getCleanerAuth,
} from "@/lib/cleaner-auth";
import {
  getCleanerOnboardingState,
  saveCleanerOnboardingStep,
} from "@/lib/queries/cleaner-onboarding";
import { syncStripeOnboardingStatus } from "@/lib/cleaner/stripe-connect";
import { z } from "zod";
import { SmsConsentInputError } from "@/lib/services/cleaner-sms-consent";

const onboardingInput = z.object({
  step: z.number().int().min(1).max(4),
  phone: z.string().max(50).optional(),
  address: z.string().max(1000).optional(),
  experienceYears: z.number().int().min(0).max(100).optional(),
  hasHotTubCert: z.boolean().optional(),
  legalDocsAcknowledged: z.boolean().optional(),
  complete: z.boolean().optional(),
  smsOptedIn: z.boolean().optional(),
  smsDisclosureVersion: z.string().max(50).optional(),
});

export async function GET() {
  const { cleanerId, error } = await getCleanerAuth();
  if (!cleanerId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized" },
      { status: cleanerAuthErrorStatus(error) }
    );
  }

  // Reconcile with Stripe before reading. Stripe is explicit that a Connect
  // `return_url` is not proof of completion — a cleaner can abandon onboarding
  // half-done and still be redirected to it — so the account's real state has
  // to come from Stripe itself. The `account.updated` webhook
  // (app/api/stripe/webhook) is the steady-state source, but a cleaner who has
  // just come back from Stripe is looking at this screen right now, and the
  // webhook may not have landed yet. Scoped to this route rather than added to
  // `getCleanerOnboardingState` so its other callers keep their pure DB read.
  // No-ops when there is no connected account, and falls back to the stored
  // values if Stripe is unreachable, so this can never block the response.
  await syncStripeOnboardingStatus(cleanerId);

  const cleaner = await getCleanerOnboardingState(cleanerId);
  return NextResponse.json({
    step: cleaner.onboardingStep,
    onboardingStarted: cleaner.onboardingStarted,
    onboardingCompleted: cleaner.onboardingCompleted,
    accountStatus: cleaner.accountStatus,
    stripeOnboardingComplete: cleaner.stripeOnboardingComplete,
    stripePayoutsEnabled: cleaner.stripePayoutsEnabled,
    stripeChargesEnabled: cleaner.stripeChargesEnabled,
    stripeAccountId: cleaner.stripeAccountId,
  });
}

export async function PATCH(request: NextRequest) {
  const { cleanerId, error } = await getCleanerAuth();
  if (!cleanerId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized" },
      { status: cleanerAuthErrorStatus(error) }
    );
  }

  try {
    const parsed = onboardingInput.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid onboarding details." }, { status: 400 });
    }
    const updated = await saveCleanerOnboardingStep(cleanerId, parsed.data);
    return NextResponse.json({ success: true, cleaner: updated });
  } catch (err) {
    if (err instanceof SmsConsentInputError || err instanceof SyntaxError) {
      return NextResponse.json({ error: err instanceof SmsConsentInputError ? err.message : "Invalid request body." }, { status: 400 });
    }
    console.error("[PATCH /api/cleaner/onboarding]", err);
    return NextResponse.json(
      { error: "Failed to update onboarding" },
      { status: 500 }
    );
  }
}
