import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { markUserNotificationRead } from "@/lib/queries/user-notifications";

function roleFromClaims(claims: Record<string, unknown> | undefined) {
  const metadata = claims?.user_metadata;
  if (metadata && typeof metadata === "object" && "role" in metadata) {
    const role = (metadata as { role?: unknown }).role;
    if (typeof role === "string") return role;
  }
  return undefined;
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const claims = data?.claims as Record<string, unknown> | undefined;

    if (!claims?.sub || typeof claims.sub !== "string") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = roleFromClaims(claims);
    if (userRole !== "admin" && userRole !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const email =
      typeof claims.email === "string" ? claims.email : undefined;

    const updated = await markUserNotificationRead(claims.sub, id, {
      email,
      role: userRole,
    });

    if (!updated) {
      return NextResponse.json({ error: "Notification not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error marking notification read:", error);
    return NextResponse.json({ error: "Failed to mark read" }, { status: 500 });
  }
}
