import { NextResponse } from "next/server";
import {
  cleanerAuthErrorStatus,
  getCleanerAuth,
  requireCleanerJobAssignment,
} from "@/lib/cleaner-auth";
import { createCleanerSwapRequest } from "@/lib/queries/cleaner-swap";

/**
 * Single-job swap request. The web portal posts to `/api/cleaner/swap-requests`
 * (which takes a selection); this route stays for the native app, and accepts
 * the same optional `reason`.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { cleanerId, error } = await getCleanerAuth();
  if (!cleanerId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized" },
      { status: cleanerAuthErrorStatus(error) }
    );
  }

  const { id: jobId } = await params;
  const { error: assignmentError } = await requireCleanerJobAssignment(
    cleanerId,
    jobId
  );

  if (assignmentError) {
    return NextResponse.json({ error: assignmentError }, { status: 403 });
  }

  // Callers may send no body at all, so a parse failure is not an error here.
  const body = (await request.json().catch(() => null)) as {
    reason?: unknown;
  } | null;
  const reason = typeof body?.reason === "string" ? body.reason : null;

  try {
    const result = await createCleanerSwapRequest(cleanerId, jobId, reason);

    if (!result.success) {
      return NextResponse.json(
        { error: result.message },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      eligibleCleanerNames: result.eligibleCleanerNames,
    });
  } catch (err) {
    console.error("[POST /api/cleaner/jobs/[id]/swap-request]", err);
    return NextResponse.json(
      { error: "Failed to create swap request" },
      { status: 500 }
    );
  }
}
