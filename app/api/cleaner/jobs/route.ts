import { NextResponse } from "next/server";
import { cleanerAuthErrorStatus, getCleanerAuth } from "@/lib/cleaner-auth";
import { getCleanerUpcomingJobs } from "@/lib/queries/cleaner-jobs";

export async function GET() {
  const { cleanerId, error } = await getCleanerAuth();

  if (!cleanerId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized", jobs: [] },
      { status: cleanerAuthErrorStatus(error) }
    );
  }

  try {
    const jobs = await getCleanerUpcomingJobs(cleanerId);
    return NextResponse.json({ jobs });
  } catch (err) {
    console.error("[GET /api/cleaner/jobs]", err);
    return NextResponse.json(
      { error: "Failed to fetch jobs" },
      { status: 500 }
    );
  }
}
