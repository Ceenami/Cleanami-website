import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/admin-auth";
import { loadAdminSmsStatus } from "@/lib/services/notifications/admin-sms.service";
export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!(await getAdminAuth(request)).isAdmin) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  try { return NextResponse.json(await loadAdminSmsStatus(), { headers }); }
  catch { return NextResponse.json({ error: "Admin SMS status unavailable; verify schema/configuration" }, { status: 503, headers }); }
}
