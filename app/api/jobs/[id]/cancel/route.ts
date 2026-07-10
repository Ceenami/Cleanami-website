import { NextRequest, NextResponse } from "next/server";
import { cancelJobAsAdmin } from "@/lib/services/customer-cancellation.service";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const userRole = data?.claims?.user_metadata?.role as string | undefined;

    if (userRole !== "admin" && userRole !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
