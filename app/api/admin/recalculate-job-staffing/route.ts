import { NextRequest, NextResponse } from "next/server";
import { recalculateJobStaffing } from "@/lib/services/recalculate-job-staffing.service";

export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      propertyId?: string;
      jobIds?: string[];
      scope?: "future_open" | "all_non_canceled";
    };

    const result = await recalculateJobStaffing({
      propertyId: body.propertyId,
      jobIds: body.jobIds,
      scope: body.scope ?? "all_non_canceled",
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("[POST /api/admin/recalculate-job-staffing]", err);
    return NextResponse.json(
      { error: "Failed to recalculate job staffing" },
      { status: 500 }
    );
  }
}
