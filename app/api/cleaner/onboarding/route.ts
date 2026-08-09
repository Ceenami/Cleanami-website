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
    const body = await request.json();
    const updated = await saveCleanerOnboardingStep(cleanerId, body);
    return NextResponse.json({ success: true, cleaner: updated });
  } catch (err) {
    console.error("[PATCH /api/cleaner/onboarding]", err);
    return NextResponse.json(
      { error: "Failed to update onboarding" },
      { status: 500 }
    );
  }
}
