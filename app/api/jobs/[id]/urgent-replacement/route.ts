import { NextRequest, NextResponse } from "next/server";
import { triggerUrgentReplacement } from "@/lib/services/urgent-replacement.service";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const user = data?.claims;
    const userRole = user?.user_metadata?.role;

    if (userRole !== "admin" && userRole !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
