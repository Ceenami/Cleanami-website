import { NextRequest, NextResponse } from "next/server";
import { getJobsWithDetails } from "@/lib/queries/jobs";
import {
  getDashboardJobDateRange,
} from "@/lib/queries/dashboard-job-window";
import {
  customerAuthErrorStatus,
  resolvePortalCustomerScope,
} from "@/lib/customer-auth";

export async function GET(request: NextRequest) {
  try {
    const scope = await resolvePortalCustomerScope(request);
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

    // Counterproposal item 12. Validated against the two literals rather than
    // cast, so an arbitrary string from the query string can never reach the
    // where-clause — an unknown value falls back to "all" and shows everything,
    // which is the safe direction for an admin list.
    const rawServiceType = searchParams.get("serviceType");
    const serviceType =
      rawServiceType === "vacation_rental_subscription" ||
      rawServiceType === "residential_one_time"
        ? rawServiceType
        : "all";

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
      serviceType,
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
