import "server-only";

import { db } from "@/db";
import { cleaners } from "@/db/schemas";
import { eq } from "drizzle-orm";

export type CleanerEligibilityRecord = Pick<
  typeof cleaners.$inferSelect,
  "eligibleForAssignments"
>;

export function meetsAssignmentRequirements(
  cleaner: {
    onboardingCompleted?: boolean | null;
    stripePayoutsEnabled?: boolean | null;
  } | null | undefined
): boolean {
  if (!cleaner) return false;
  return (
    cleaner.onboardingCompleted === true &&
    cleaner.stripePayoutsEnabled === true
  );
}

/** Cleaner may receive assignments, payouts, and on-call pool inclusion. */
export function isCleanerAssignmentEligible(
  cleaner: CleanerEligibilityRecord | null | undefined
): boolean {
  if (!cleaner) return false;
  return cleaner.eligibleForAssignments === true;
}

export async function syncEligibleForAssignments(
  cleanerId: string
): Promise<void> {
  const cleaner = await db.query.cleaners.findFirst({
    where: eq(cleaners.id, cleanerId),
    columns: {
      onboardingCompleted: true,
      stripePayoutsEnabled: true,
      eligibleForAssignments: true,
    },
  });

  if (!cleaner || cleaner.eligibleForAssignments) return;

  if (meetsAssignmentRequirements(cleaner)) {
    await db
      .update(cleaners)
      .set({ eligibleForAssignments: true, updatedAt: new Date() })
      .where(eq(cleaners.id, cleanerId));
  }
}

export function getAssignmentEligibilityLabel(cleaner: {
  eligibleForAssignments: boolean | null;
  onboardingCompleted: boolean | null;
  stripePayoutsEnabled: boolean | null;
}): string {
  if (!cleaner.eligibleForAssignments) {
    return "Not eligible";
  }
  if (meetsAssignmentRequirements(cleaner)) {
    return "Eligible (requirements met)";
  }
  return "Eligible (admin override)";
}

export function hasRequiredLegalDocs(
  legalDocsSigned: typeof cleaners.$inferSelect.legalDocsSigned
): boolean {
  if (!legalDocsSigned) return false;
  return Boolean(
    legalDocsSigned.w9Url &&
      legalDocsSigned.liabilityWaiverUrl &&
      legalDocsSigned.gpsConsentUrl &&
      legalDocsSigned.contractorAgreementUrl
  );
}

export function isCleanerPortalUnlocked(
  cleaner: Pick<
    typeof cleaners.$inferSelect,
    "onboardingCompleted" | "accountStatus"
  > | null | undefined
): boolean {
  if (!cleaner) return false;
  return cleaner.onboardingCompleted === true;
}

export function getCleanerOnboardingBannerMessage(
  cleaner: Pick<
    typeof cleaners.$inferSelect,
    | "onboardingCompleted"
    | "accountStatus"
    | "stripePayoutsEnabled"
    | "stripeOnboardingComplete"
  > | null
): string | null {
  if (!cleaner) return null;
  if (!cleaner.onboardingCompleted) {
    return "Complete onboarding to access jobs, availability, and payouts.";
  }
  if (cleaner.accountStatus === "suspended") {
    return "Your account is suspended. Contact CleanNami support.";
  }
  if (!cleaner.stripePayoutsEnabled) {
    return "Finish Stripe Connect setup to become eligible for job assignments and payouts.";
  }
  return null;
}
