import { NextResponse } from "next/server";
import {
  cleanerAuthErrorStatus,
  getCleanerAuth,
} from "@/lib/cleaner-auth";
import { createStripeOnboardingLink } from "@/lib/cleaner/stripe-connect";

export async function GET() {
  const { cleanerId, error } = await getCleanerAuth();
  if (!cleanerId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized" },
      { status: cleanerAuthErrorStatus(error) }
    );
  }

  try {
    const { url } = await createStripeOnboardingLink(cleanerId);
    return NextResponse.json({ url });
  } catch (err) {
    console.error("[GET /api/cleaner/stripe-onboarding-link]", err);
    const message =
      err instanceof Error ? err.message : "Failed to create onboarding link";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
