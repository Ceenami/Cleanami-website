import { NextRequest, NextResponse } from "next/server";
import { getJobStats } from "@/lib/queries/stats";
import {
  customerAuthErrorStatus,
  resolvePortalCustomerScope,
} from "@/lib/customer-auth";

export async function GET(request: NextRequest) {
  try {
    const scope = await resolvePortalCustomerScope(request);
    if (scope.error) {
      return NextResponse.json(
        { error: scope.error },
        { status: customerAuthErrorStatus(scope.error) }
      );
    }

    const stats = await getJobStats(scope.customerId);
    return NextResponse.json(stats);
  } catch (error) {
    console.error("Error fetching job stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch job stats" },
      { status: 500 }
    );
  }
}

export type GetJobStatsResponse = Awaited<ReturnType<typeof getJobStats>>;
