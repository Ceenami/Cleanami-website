import "server-only";

import { db } from "@/db";
import { cleaners } from "@/db/schemas";
import { syncStripeOnboardingStatus } from "@/lib/cleaner/stripe-connect";
import { eq } from "drizzle-orm";

export type CleanerProfile = {
  fullName: string;
  email: string;
  phone: string | null;
  reliabilityScore: number;
  stripeOnboardingComplete: boolean;
  badges: { id: string; name: string; icon: string; description: string }[];
};

export async function getCleanerProfile(
  cleanerId: string
): Promise<CleanerProfile | null> {
  const stripeComplete = await syncStripeOnboardingStatus(cleanerId);

  const cleaner = await db.query.cleaners.findFirst({
    where: eq(cleaners.id, cleanerId),
    columns: {
      fullName: true,
      email: true,
      phone: true,
      reliabilityScore: true,
      stripeOnboardingComplete: true,
    },
    with: {
      cleanerBadges: {
        with: { badge: true },
      },
    },
  });

  if (!cleaner) return null;

  const score = parseFloat(cleaner.reliabilityScore ?? "100");

  return {
    fullName: cleaner.fullName,
    email: cleaner.email,
    phone: cleaner.phone,
    reliabilityScore: Math.round(score),
    stripeOnboardingComplete: stripeComplete,
    badges: cleaner.cleanerBadges.map((cb) => ({
      id: cb.badge.id,
      name: cb.badge.name,
      icon: cb.badge.icon,
      description: cb.badge.description,
    })),
  };
}
