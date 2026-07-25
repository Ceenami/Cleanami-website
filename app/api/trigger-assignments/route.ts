import { NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/admin-auth";
import { runAssignmentEngine } from "@/lib/services/assignment/assignment-engine.service";

/**
 * Admin "Assignment Engine -> Run now" (sidebar).
 *
 * Runs the IN-REPO assignment engine. This route previously called
 * `supabase.functions.invoke("job-assignment-engine")` — a Supabase edge
 * function that lives outside this repository and was superseded by
 * `runAssignmentEngine()` (see assignment-engine.service.ts, "in-repo
 * replacement for the former job-assignment-engine edge function"). The
 * replacement landed but this route was never repointed, so the button kept
 * dispatching real jobs through remote, unreviewed code with different
 * behaviour and different skip wording — and none of the fixes or the 44/44
 * E2E coverage on the in-repo engine applied to what the button actually ran.
 */
export async function POST() {
  try {
    const { isAdmin, error: authError } = await getAdminAuth();
    if (!isAdmin) {
      return NextResponse.json(
        { success: false, error: authError ?? "Unauthorized" },
        { status: 401 }
      );
    }

    const summary = await runAssignmentEngine();

    return NextResponse.json({
      success: true,
      message: `Assigned ${summary.assigned}, skipped ${summary.skipped}.`,
      summary: {
        totalProcessed: summary.outcomes.length,
        assigned: summary.assigned,
        skipped: summary.skipped,
      },
      results: summary.outcomes.map((outcome) =>
        outcome.status === "assigned"
          ? {
              jobId: outcome.jobId,
              status: "assigned" as const,
              assignments: {
                primary: outcome.primaryCleanerId,
                backup: outcome.backupCleanerId ?? undefined,
              },
            }
          : {
              jobId: outcome.jobId,
              status: "skipped" as const,
              reason: outcome.reason,
            }
      ),
      errors: summary.errors,
    });
  } catch (error) {
    console.error("[POST /api/trigger-assignments]", error);
    return NextResponse.json(
      { success: false, error: "Failed to run the assignment engine." },
      { status: 500 }
    );
  }
}
