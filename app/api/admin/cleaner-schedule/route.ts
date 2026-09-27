import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/admin-auth";
import {
  getAdminCleanerSchedule,
  resolveAdminCleanerScheduleRange,
} from "@/lib/queries/admin-cleaner-schedule";

export async function GET(request: NextRequest) {
  const { isAdmin, error } = await getAdminAuth(request);
  if (!isAdmin) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  try {
    const range = resolveAdminCleanerScheduleRange({
      start: request.nextUrl.searchParams.get("start"),
      end: request.nextUrl.searchParams.get("end"),
    });
    return NextResponse.json(await getAdminCleanerSchedule(range));
  } catch (cause) {
    return NextResponse.json(
      {
        error:
          cause instanceof Error ? cause.message : "Unable to load staffing schedule",
      },
      { status: 400 }
    );
  }
}
