import "server-only";

import { db } from "@/db";
import { cleaners } from "@/db/schemas";
import { isCleanerAssignmentEligible } from "@/lib/cleaner/eligibility";
import { eq } from "drizzle-orm";

export async function requireCleanerAssignmentEligible(cleanerId: string): Promise<{
  eligible: boolean;
  error: string | null;
}> {
  const cleaner = await db.query.cleaners.findFirst({
    where: eq(cleaners.id, cleanerId),
    columns: {
      id: true,
      eligibleForAssignments: true,
    },
  });

  if (!cleaner) {
    return { eligible: false, error: "Cleaner profile not found" };
  }

  if (!isCleanerAssignmentEligible(cleaner)) {
    return {
      eligible: false,
      error:
        "You are not eligible for job assignments yet. Contact CleanNami support or finish onboarding.",
    };
  }

  return { eligible: true, error: null };
}
