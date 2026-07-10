import { NextResponse } from "next/server";
import {
  cleanerAuthErrorStatus,
  getCleanerAuth,
} from "@/lib/cleaner-auth";
import { acceptUrgentJob } from "@/lib/services/urgent-replacement.service";

export async function POST(
  _request: Request,
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

  try {
    const result = await acceptUrgentJob(cleanerId, jobId);

    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 409 });
    }

    return NextResponse.json({
      success: true,
      message: "You accepted this urgent job. $10 bonus applies.",
    });
  } catch (err) {
    console.error("[POST /api/cleaner/jobs/[id]/accept-urgent]", err);
    return NextResponse.json(
      { error: "Failed to accept urgent job" },
      { status: 500 }
    );
  }
}
