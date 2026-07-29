import { NextResponse } from "next/server";
import {
  cleanerAuthErrorStatus,
  getCleanerAuth,
  requireCleanerJobAssignment,
} from "@/lib/cleaner-auth";
import {
  createCleanerSwapRequest,
  SWAP_REASON_MAX_LENGTH,
} from "@/lib/queries/cleaner-swap";

type SubmitResult = {
  jobId: string;
  success: boolean;
  message: string;
};

/**
 * Files swap requests for the jobs the cleaner picked.
 *
 * Batched rather than one-shot per card: the cleaner chooses which of their
 * upcoming cleans to hand back, and each job is reported on individually so a
 * single ineligible pick never hides the others' outcome.
 */
export async function POST(request: Request) {
  const { cleanerId, error } = await getCleanerAuth();
  if (!cleanerId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized" },
      { status: cleanerAuthErrorStatus(error) }
    );
  }

  let body: { jobIds?: unknown; reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const jobIds = Array.isArray(body.jobIds)
    ? [...new Set(body.jobIds.filter((id): id is string => typeof id === "string"))]
    : [];

  if (jobIds.length === 0) {
    return NextResponse.json(
      { error: "Select at least one job to request a swap for." },
      { status: 400 }
    );
  }

  const reason =
    typeof body.reason === "string"
      ? body.reason.trim().slice(0, SWAP_REASON_MAX_LENGTH)
      : null;

  try {
    const results: SubmitResult[] = [];

    for (const jobId of jobIds) {
      const { error: assignmentError } = await requireCleanerJobAssignment(
        cleanerId,
        jobId
      );

      if (assignmentError) {
        results.push({ jobId, success: false, message: assignmentError });
        continue;
      }

      const result = await createCleanerSwapRequest(cleanerId, jobId, reason);
      results.push({ jobId, success: result.success, message: result.message });
    }

    const submitted = results.filter((r) => r.success).length;

    return NextResponse.json({
      success: submitted > 0,
      submitted,
      results,
    });
  } catch (err) {
    console.error("[POST /api/cleaner/swap-requests]", err);
    return NextResponse.json(
      { error: "Failed to create swap request" },
      { status: 500 }
    );
  }
}
