import { NextRequest, NextResponse } from "next/server";
import { triggerUrgentReplacement } from "@/lib/services/urgent-replacement.service";
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
    const result = await triggerUrgentReplacement(id);

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Error triggering urgent replacement:", error);
    const message =
      error instanceof Error
        ? error.message
        : "Failed to trigger urgent replacement";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
