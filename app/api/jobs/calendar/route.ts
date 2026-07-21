import { NextRequest, NextResponse } from "next/server";
import { getJobsForCalendar } from "@/lib/queries/jobs";
import { getAdminAuth } from "@/lib/admin-auth";

export async function GET(request: NextRequest) {
  try {
    const { isAdmin, error: authError } = await getAdminAuth(request);
    if (!isAdmin) {
      return NextResponse.json(
        { error: authError ?? "Unauthorized" },
        { status: 401 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get("startDate")
      ? new Date(searchParams.get("startDate")!)
      : new Date();
    const endDate = searchParams.get("endDate")
      ? new Date(searchParams.get("endDate")!)
      : new Date(new Date().getTime() + 30 * 24 * 60 * 60 * 1000);

    const jobsByDate = await getJobsForCalendar({ startDate, endDate });
    return NextResponse.json(jobsByDate);
  } catch (error) {
    console.error("Error fetching calendar jobs:", error);
    return NextResponse.json(
      { error: "Failed to fetch calendar jobs" },
      { status: 500 }
    );
  }
}

export type GetJobsForCalendarResponse = Awaited<ReturnType<typeof getJobsForCalendar>>;
