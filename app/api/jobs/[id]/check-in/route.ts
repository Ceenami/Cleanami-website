import { db } from "@/db";
import { jobsToCleaners } from "@/db/schemas";
import { eq } from "drizzle-orm";
import { executionResponse, executionVisitRequest } from "@/lib/services/job-execution-http";
import { ExecutionError } from "@/lib/services/job-execution";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminAuth } from "@/lib/admin-auth";
import { JobVisitError, recordJobArrival } from "@/lib/services/job-visit";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { isAdmin, error } = await getAdminAuth(request);
  if (!isAdmin)
    return NextResponse.json(
      { error: error ?? "Unauthorized" },
      { status: 401 },
    );
  const { id } = await params;
  if (!z.uuid().safeParse(id).success)
    return NextResponse.json({ error: "Invalid job" }, { status: 400 });
  const issuedResponse = await executionResponse(id, async () => {
    const assignments = await db.query.jobsToCleaners.findMany({ where: eq(jobsToCleaners.jobId, id) });
    const workers = assignments.filter(a => a.role === "primary");
    const leader = workers.find(a => a.isTeamLeader) ?? (workers.length === 1 ? workers[0] : undefined);
    if (!leader) throw new ExecutionError("Select an unambiguous working lead before recording this visit");
    return executionVisitRequest(request, id, leader.cleanerId, "arrival");
  });
  if (issuedResponse) return issuedResponse;
  try {
    const { started } = await recordJobArrival({ jobId: id, now: new Date() });
    return NextResponse.json({ success: true, alreadyCheckedIn: !started });
  } catch (error) {
    if (error instanceof JobVisitError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    console.error("[Admin check-in]", error);
    return NextResponse.json({ error: "Failed to check in" }, { status: 500 });
  }
}
