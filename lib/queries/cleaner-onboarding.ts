import "server-only";

import { db } from "@/db";
import { cleaners } from "@/db/schemas";
import {
  createStripeOnboardingLink,
  syncStripeOnboardingStatus,
} from "@/lib/cleaner/stripe-connect";
import { logCleanerAuditEvent } from "@/lib/queries/cleaner-invitations";
import { syncEligibleForAssignments } from "@/lib/cleaner/eligibility";
import { eq } from "drizzle-orm";

export async function getCleanerOnboardingState(cleanerId: string) {
  const cleaner = await db.query.cleaners.findFirst({
    where: eq(cleaners.id, cleanerId),
  });

  if (!cleaner) {
    throw new Error("Cleaner not found");
  }

  return cleaner;
}

export async function saveCleanerOnboardingStep(
  cleanerId: string,
  input: {
    step: number;
    phone?: string;
    address?: string;
    experienceYears?: number;
    hasHotTubCert?: boolean;
    legalDocsAcknowledged?: boolean;
    complete?: boolean;
  }
) {
  const cleaner = await db.query.cleaners.findFirst({
    where: eq(cleaners.id, cleanerId),
  });

  if (!cleaner) {
    throw new Error("Cleaner not found");
  }

  const now = new Date();
  const patch: Partial<typeof cleaners.$inferInsert> = {
    onboardingStep: input.step,
    updatedAt: now,
  };

  if (input.phone !== undefined) patch.phone = input.phone;
  if (input.address !== undefined) patch.address = input.address;
  if (input.experienceYears !== undefined) {
    patch.experienceYears = input.experienceYears;
  }
  if (input.hasHotTubCert !== undefined) {
    patch.hasHotTubCert = input.hasHotTubCert;
  }

  if (input.legalDocsAcknowledged) {
    patch.legalDocsSigned = {
      w9Url: "acknowledged",
      liabilityWaiverUrl: "acknowledged",
      gpsConsentUrl: "acknowledged",
      contractorAgreementUrl: "acknowledged",
    };
  }

  if (input.complete) {
    patch.onboardingCompleted = true;
    patch.onboardingCompletedAt = now;
    patch.accountStatus = "stripe_pending";
    patch.onboardingStep = 4;
  }

  const [updated] = await db
    .update(cleaners)
    .set(patch)
    .where(eq(cleaners.id, cleanerId))
    .returning();

  if (input.complete) {
    await logCleanerAuditEvent({
      action: "onboarding_completed",
      cleanerId,
      metadata: {},
    });
    await logCleanerAuditEvent({
      action: "stripe_onboarding_started",
      cleanerId,
      metadata: {},
    });
    await syncEligibleForAssignments(cleanerId);
  }

  return updated;
}

export async function startStripeOnboardingAfterWizard(cleanerId: string) {
  await syncStripeOnboardingStatus(cleanerId);
  return createStripeOnboardingLink(cleanerId);
}
