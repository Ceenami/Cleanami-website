import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { jobs, jobsToCleaners, users } from "@/db/schemas";
import { createAdminClient } from "@/lib/supabase/server";
import {
  cleanerAuthErrorStatus,
  getCleanerAuth,
} from "@/lib/cleaner-auth";

// A cleaner cannot erase their account while their work, evidence obligation,
// or payout is still in flight. All four states need an operational handoff.
const ACTIVE_JOB_STATUSES = [
  "assigned",
  "in-progress",
  "completed_pending_evidence",
  "awaiting_capture",
] as const;

/**
 * Permanently removes the authenticated cleaner account.
 *
 * The public user row is the application-owned cascade root; deleting only the
 * Supabase auth account leaves its cleaner profile and assignments behind.
 * Auth is removed first so refresh tokens are invalidated immediately, then the
 * public row removes cleaner-owned records through the established FK cascade.
 */
export async function DELETE(request: NextRequest) {
  const { cleanerId, userId, supabaseUserId, error } = await getCleanerAuth();
  if (!cleanerId || !userId || !supabaseUserId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized" },
      { status: cleanerAuthErrorStatus(error) }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  if (
    !body ||
    typeof body !== "object" ||
    (body as { confirmation?: unknown }).confirmation !== "DELETE"
  ) {
    return NextResponse.json(
      { error: 'Confirm account deletion by sending confirmation: "DELETE".' },
      { status: 400 }
    );
  }

  try {
    const activeAssignment = await db
      .select({ jobId: jobs.id })
      .from(jobsToCleaners)
      .innerJoin(jobs, eq(jobsToCleaners.jobId, jobs.id))
      .where(
        and(
          eq(jobsToCleaners.cleanerId, cleanerId),
          inArray(jobs.status, ACTIVE_JOB_STATUSES)
        )
      )
      .limit(1);

    if (activeAssignment.length > 0) {
      return NextResponse.json(
        {
          error:
            "You have active work or a pending payout. Finish it or contact CleanNami for a handoff before deleting your account.",
        },
        { status: 409 }
      );
    }

    const admin = createAdminClient();
    const { error: authDeleteError } = await admin.auth.admin.deleteUser(
      supabaseUserId,
      false
    );
    if (authDeleteError) {
      console.error("[DELETE /api/cleaner/account] auth delete failed", authDeleteError);
      return NextResponse.json(
        { error: "Could not delete your account. Please try again." },
        { status: 502 }
      );
    }

    // Do not accept an id from the request. This exact key was resolved from
    // the verified JWT above. A failure here is deliberately loud: the auth
    // record is already gone, and an operator must complete the public cascade.
    await db.delete(users).where(eq(users.id, userId));

    return NextResponse.json({ success: true });
  } catch (cause) {
    console.error("[DELETE /api/cleaner/account] public cascade failed", cause);
    return NextResponse.json(
      {
        error:
          "Your sign-in was removed, but we could not finish deleting account data. CleanNami has been notified to complete the deletion.",
      },
      { status: 500 }
    );
  }
}
