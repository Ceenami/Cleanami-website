import "server-only";

import { getDbOrNull } from "@/db";
import { cleaners, jobsToCleaners, users } from "@/db/schemas";
import { createClient } from "@/lib/supabase/server";
import { SERVICE_UNAVAILABLE } from "@/lib/env/messages";
import { and, eq } from "drizzle-orm";

export type CleanerAuthResult = {
  cleanerId: string | null;
  error: string | null;
};

const PROFILE_NOT_FOUND_MESSAGE =
  "We could not load your cleaner profile. Complete cleaner sign-up with your approved invitation email, or contact support.";

const INVITATION_REQUIRED_MESSAGE =
  "Your email has not been approved for cleaner access. Please contact CleanNami.";

/**
 * Resolves the authenticated cleaner's ID from the current session.
 * Use in all /api/cleaner/* routes to scope data to the logged-in cleaner.
 */
export async function getCleanerAuth(): Promise<CleanerAuthResult> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (!claims?.sub) {
    return { cleanerId: null, error: "Unauthorized" };
  }

  const userRole = claims.user_metadata?.role;
  if (userRole !== "cleaner") {
    return { cleanerId: null, error: "Forbidden" };
  }

  const database = getDbOrNull();
  if (!database) {
    return { cleanerId: null, error: SERVICE_UNAVAILABLE.database };
  }

  try {
    const dbUser = await database.query.users.findFirst({
      where: eq(users.supabaseUserId, claims.sub),
      columns: { id: true },
    });

    if (!dbUser) {
      return { cleanerId: null, error: PROFILE_NOT_FOUND_MESSAGE };
    }

    const cleaner = await database.query.cleaners.findFirst({
      where: eq(cleaners.userId, dbUser.id),
      columns: {
        id: true,
        invitationId: true,
        onboardingCompleted: true,
      },
    });

    if (!cleaner) {
      return { cleanerId: null, error: PROFILE_NOT_FOUND_MESSAGE };
    }

    // New signups must come through an approved invitation. Legacy cleaners who
    // finished onboarding before invitation tracking may not have invitation_id.
    if (!cleaner.invitationId && !cleaner.onboardingCompleted) {
      return { cleanerId: null, error: INVITATION_REQUIRED_MESSAGE };
    }

    return { cleanerId: cleaner.id, error: null };
  } catch (error) {
    console.error("[getCleanerAuth] database error", error);
    return { cleanerId: null, error: SERVICE_UNAVAILABLE.database };
  }
}

export async function requireCleanerJobAssignment(
  cleanerId: string,
  jobId: string
) {
  const database = getDbOrNull();
  if (!database) {
    return { assignment: null, error: SERVICE_UNAVAILABLE.database };
  }

  const assignment = await database.query.jobsToCleaners.findFirst({
    where: and(
      eq(jobsToCleaners.cleanerId, cleanerId),
      eq(jobsToCleaners.jobId, jobId)
    ),
  });

  if (!assignment) {
    return { assignment: null, error: "Not assigned to this job" };
  }

  return { assignment, error: null };
}

export function cleanerAuthErrorStatus(error: string | null): number {
  if (
    error === SERVICE_UNAVAILABLE.database ||
    error?.toLowerCase().includes("profile")
  ) {
    return 503;
  }
  if (error === "Forbidden" || error === "Not assigned to this job") {
    return 403;
  }
  return 401;
}
