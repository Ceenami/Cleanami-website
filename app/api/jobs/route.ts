import { NextRequest, NextResponse } from "next/server";
import { getJobsWithDetails } from "@/lib/queries/jobs";
import {
  getDashboardJobDateRange,
} from "@/lib/queries/dashboard-job-window";
import { createClient } from "@/lib/supabase/server";
import {
  customerAuthErrorStatus,
  resolvePortalCustomerScope,
} from "@/lib/customer-auth";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const userRole = data?.claims?.user_metadata?.role as string | undefined;

    const scope = await resolvePortalCustomerScope(request, userRole);
    if (scope.error) {
      return NextResponse.json(
        { error: scope.error, data: [], nextPage: null },
        { status: customerAuthErrorStatus(scope.error) }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const isDashboard = searchParams.get("dashboard") === "1";
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(
      searchParams.get("limit") || (isDashboard ? "20" : "10")
    );
    const status = (searchParams.get("status") || "all") as
      | "unassigned"
      | "assigned"
      | "in-progress"
      | "completed"
      | "canceled"
      | "all";
    const query = searchParams.get("query") || "";

    let startDate = searchParams.get("startDate")
      ? new Date(searchParams.get("startDate")!)
      : undefined;
    let endDate = searchParams.get("endDate")
      ? new Date(searchParams.get("endDate")!)
      : undefined;

    if (isDashboard && !startDate && !endDate) {
      const range = getDashboardJobDateRange();
      startDate = range.startDate;
      endDate = range.endDate;
    }

    const result = await getJobsWithDetails({
      page,
      limit,
      status,
      query,
      startDate,
      endDate,
      customerId: scope.customerId,
      sortByCheckIn: isDashboard ? "asc" : undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching jobs:", error);
    return NextResponse.json(
      { error: "Failed to fetch jobs" },
      { status: 500 }
    );
  }
}

export type GetJobsResponse = Awaited<ReturnType<typeof getJobsWithDetails>>;
