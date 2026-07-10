import { NextRequest, NextResponse } from "next/server";
import {
  cleanerAuthErrorStatus,
  getCleanerAuth,
} from "@/lib/cleaner-auth";
import {
  getCleanerOnboardingState,
  saveCleanerOnboardingStep,
} from "@/lib/queries/cleaner-onboarding";

export async function GET() {
  const { cleanerId, error } = await getCleanerAuth();
  if (!cleanerId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized" },
      { status: cleanerAuthErrorStatus(error) }
    );
  }

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
