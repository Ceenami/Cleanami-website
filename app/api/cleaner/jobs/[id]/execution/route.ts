import { db } from "@/db";
import { evidencePackets } from "@/db/schemas";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import {
  getCleanerAuth,
  cleanerAuthErrorStatus,
  requireCleanerJobAssignment,
} from "@/lib/cleaner-auth";
import { executionResponse } from "@/lib/services/job-execution-http";
import {
  getExecutionEvidence,
  reserveExecutionUpload,
  acknowledgeExecutionUpload,
  saveExecutionDraft,
  removeExecutionUpload,
  ExecutionError,
} from "@/lib/services/job-execution";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getCleanerAuth();
  if (!auth.cleanerId)
    return NextResponse.json(
      { error: auth.error },
      { status: cleanerAuthErrorStatus(auth.error) },
    );
  const { id } = await params;
  return (
    (await executionResponse(id, async () => {
      if (new URL(request.url).searchParams.get("capabilities") === "1") {
        const assignment = await requireCleanerJobAssignment(
          auth.cleanerId!,
          id,
        );
        if (assignment.error) throw new ExecutionError(assignment.error, 403);
        const packet = await db.query.evidencePackets.findFirst({
          where: eq(evidencePackets.jobId, id),
          columns: { finalEvidenceSubmittedAt: true },
        });
        return {
          protocol: "pre2c-hotfix-v1",
          isSubmitted: !!packet?.finalEvidenceSubmittedAt,
        };
      }
      return getExecutionEvidence(id, auth.cleanerId!);
    })) ?? NextResponse.json({ protocol: null })
  );
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getCleanerAuth();
  if (!auth.cleanerId)
    return NextResponse.json(
      { error: auth.error },
      { status: cleanerAuthErrorStatus(auth.error) },
    );
  const { id } = await params;
  return (
    (await executionResponse(id, async () => {
      const body = await request.json();
      switch (body.operation) {
        case "reserve":
          return reserveExecutionUpload(id, auth.cleanerId!, body);
        case "acknowledge":
          return acknowledgeExecutionUpload(id, auth.cleanerId!, body.uploadId);
        case "remove":
          return removeExecutionUpload(id, auth.cleanerId!, body.uploadId);
        case "draft":
          return saveExecutionDraft(id, auth.cleanerId!, body);
        case "finalize":
          return saveExecutionDraft(id, auth.cleanerId!, body, true);
        default:
          throw new ExecutionError("Unknown operation", 400);
      }
    })) ??
    NextResponse.json(
      { error: "Use the existing job workflow" },
      { status: 409 },
    )
  );
}
