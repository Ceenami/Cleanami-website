import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/admin-auth";
import { cancelSubscriptionAsAdmin } from "@/lib/services/customer-cancellation.service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { isAdmin, error } = await getAdminAuth(request);
  if (!isAdmin) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const result = await cancelSubscriptionAsAdmin(id);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("[POST /api/subscriptions/[id]/cancel]", err);
    const message =
      err instanceof Error ? err.message : "Failed to cancel subscription";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
