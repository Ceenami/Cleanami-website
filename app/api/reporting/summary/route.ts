import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { getAdminAuth } from "@/lib/admin-auth";
import { getReportingSummary } from "@/lib/queries/reporting";

export async function GET(request: NextRequest) {
  const { isAdmin, error } = await getAdminAuth(request);
  if (!isAdmin) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await getReportingSummary();

    if (request.nextUrl.searchParams.get("format") === "csv") {
      const rows = [
        { metric: "Revenue ($)", value: summary.revenue.toFixed(2) },
        { metric: "Cleaner Payouts ($)", value: summary.cleanerPayouts.toFixed(2) },
        { metric: "Reserve Held ($)", value: summary.reserveHeld.toFixed(2) },
        { metric: "Margin ($)", value: summary.margin.toFixed(2) },
        { metric: "Jobs Total", value: summary.jobs.total },
        { metric: "Jobs Completed", value: summary.jobs.completed },
        { metric: "Jobs Canceled", value: summary.jobs.canceled },
        { metric: "Jobs Upcoming", value: summary.jobs.upcoming },
        { metric: "Coverage Rate (%)", value: summary.coverageRate },
        { metric: "Dispute Rate (%)", value: summary.disputeRate },
        { metric: "Late Rate (%)", value: summary.lateRate },
        { metric: "Retention Rate (%)", value: summary.retentionRate },
        { metric: "Active Subscriptions", value: summary.subscriptions.active },
        { metric: "Paused Subscriptions", value: summary.subscriptions.paused },
        { metric: "Canceled Subscriptions", value: summary.subscriptions.canceled },
      ];
      const csv = Papa.unparse(rows);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="cleannami-report-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    return NextResponse.json(summary);
  } catch (err) {
    console.error("[GET /api/reporting/summary]", err);
    return NextResponse.json(
      { error: "Failed to build report" },
      { status: 500 }
    );
  }
}
