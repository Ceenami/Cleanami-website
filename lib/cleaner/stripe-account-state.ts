import "server-only";

import { db } from "@/db";
import { cleaners } from "@/db/schemas";
import { logCleanerAuditEvent } from "@/lib/queries/cleaner-invitations";
import { syncEligibleForAssignments } from "@/lib/cleaner/eligibility";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";

export async function applyStripeAccountState(
  cleanerId: string,
  account: Stripe.Account
) {
  const chargesEnabled = account.charges_enabled === true;
  const payoutsEnabled = account.payouts_enabled === true;
  const stripeOnboardingComplete =
    account.details_submitted === true && chargesEnabled && payoutsEnabled;
  const now = new Date();

  const existing = await db.query.cleaners.findFirst({
    where: eq(cleaners.id, cleanerId),
    columns: {
      accountStatus: true,
      onboardingCompleted: true,
      stripeOnboardingComplete: true,
      stripePayoutsEnabled: true,
    },
  });

  if (!existing) return;

  const isActive =
    existing.onboardingCompleted === true && payoutsEnabled === true;

  const nextStatus =
    existing.accountStatus === "suspended"
      ? "suspended"
      : isActive
        ? "active"
        : existing.accountStatus === "onboarding_in_progress"
          ? "onboarding_in_progress"
          : "stripe_pending";

  const becameActive =
    nextStatus === "active" &&
    !existing.stripePayoutsEnabled &&
    payoutsEnabled;

  await db
    .update(cleaners)
    .set({
      stripeChargesEnabled: chargesEnabled,
      stripePayoutsEnabled: payoutsEnabled,
      stripeOnboardingComplete: stripeOnboardingComplete,
      stripeOnboardingCompletedAt: stripeOnboardingComplete ? now : null,
      accountStatus: nextStatus,
      ...(becameActive ? { activatedAt: now } : {}),
      updatedAt: now,
    })
    .where(eq(cleaners.id, cleanerId));

  if (stripeOnboardingComplete && !existing.stripeOnboardingComplete) {
    await logCleanerAuditEvent({
      action: "stripe_onboarding_completed",
      cleanerId,
      metadata: {
        chargesEnabled,
        payoutsEnabled,
      },
    });
  }

  if (nextStatus === "active" && becameActive) {
    await logCleanerAuditEvent({
      action: "account_activated",
      cleanerId,
      metadata: {},
    });
  }

  await syncEligibleForAssignments(cleanerId);
}
