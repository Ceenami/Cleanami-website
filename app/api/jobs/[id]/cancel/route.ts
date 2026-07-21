import { NextRequest, NextResponse } from "next/server";
import { cancelJobAsAdmin } from "@/lib/services/customer-cancellation.service";
import { getAdminAuth } from "@/lib/admin-auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { isAdmin, error: authError } = await getAdminAuth(request);
    if (!isAdmin) {
      return NextResponse.json(
        { error: authError ?? "Unauthorized" },
        { status: 401 }
      );
    }

    const { id } = await params;
    const result = await cancelJobAsAdmin(id);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Error canceling job:", error);
    const message =
      error instanceof Error ? error.message : "Failed to cancel job";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
