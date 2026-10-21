import { executionResponse, executionVisitRequest } from "@/lib/services/job-execution-http";
import { jobsToCleaners as executionAssignments } from "@/db/schemas";
import { ExecutionError } from "@/lib/services/job-execution";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { jobs, evidencePackets } from "@/db/schemas";
import { eq } from "drizzle-orm";
import { getAdminAuth } from "@/lib/admin-auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { isAdmin, error: authError } = await getAdminAuth(request);
    if (!isAdmin) {
      return NextResponse.json(
        { error: authError ?? "Unauthorized" },
        { status: 401 }
      );
    }

    const { id } = await params;

  const issuedResponse = await executionResponse(id, async () => {
    const assignments = await db.query.jobsToCleaners.findMany({ where: eq(executionAssignments.jobId, id) });
    const workers = assignments.filter(a => a.role === "primary");
    const leader = workers.find(a => a.isTeamLeader) ?? (workers.length === 1 ? workers[0] : undefined);
    if (!leader) throw new ExecutionError("Select an unambiguous working lead before recording this visit");
    return executionVisitRequest(request, id, leader.cleanerId, "departure");
  });
  if (issuedResponse) return issuedResponse;

    await db
      .update(jobs)
      .set({
        status: "completed",
        checkOutTime: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, id));

    await db
      .update(evidencePackets)
      .set({
        gpsCheckOutTimestamp: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(evidencePackets.jobId, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error checking out:", error);
    return NextResponse.json({ error: "Failed to check out" }, { status: 500 });
  }
}
