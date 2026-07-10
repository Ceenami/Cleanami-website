import { NextRequest, NextResponse } from "next/server";
import { getJobsForCalendar } from "@/lib/queries/jobs";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const user = data?.claims;
    const userRole = user?.user_metadata?.role;

    if (userRole !== "admin" && userRole !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
