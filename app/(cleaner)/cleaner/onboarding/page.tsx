import { OnboardingWizard } from "@/components/cleaner/OnboardingWizard";
import { getCleanerAuth } from "@/lib/cleaner-auth";
import { isCleanerPortalUnlocked } from "@/lib/cleaner/eligibility";
import { getCleanerOnboardingState } from "@/lib/queries/cleaner-onboarding";
import { syncStripeOnboardingStatus } from "@/lib/cleaner/stripe-connect";
import { redirect } from "next/navigation";

export default async function CleanerOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ stripe?: string }>;
}) {
  const { cleanerId } = await getCleanerAuth();
  if (!cleanerId) {
    redirect("/sign-in");
  }

  const params = await searchParams;
  if (params.stripe === "complete" || params.stripe === "refresh") {
    await syncStripeOnboardingStatus(cleanerId);
  }

  const cleaner = await getCleanerOnboardingState(cleanerId);

  if (isCleanerPortalUnlocked(cleaner)) {
    redirect("/cleaner/jobs");
  }

  const legal = cleaner.legalDocsSigned;

  return (
    <OnboardingWizard
      initial={{
        step: cleaner.onboardingStep ?? 1,
        phone: cleaner.phone ?? "",
        address: cleaner.address ?? "",
        experienceYears: cleaner.experienceYears?.toString() ?? "",
        hasHotTubCert: cleaner.hasHotTubCert ?? false,
        legalDocsAcknowledged: Boolean(
          legal?.w9Url &&
            legal?.contractorAgreementUrl &&
            legal?.gpsConsentUrl &&
            legal?.liabilityWaiverUrl
        ),
        onboardingCompleted: cleaner.onboardingCompleted ?? false,
        stripeOnboardingComplete: cleaner.stripeOnboardingComplete ?? false,
        stripePayoutsEnabled: cleaner.stripePayoutsEnabled ?? false,
      }}
    />
  );
}
