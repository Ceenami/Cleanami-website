import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserNotificationsBySupabaseId, markAllUserNotificationsRead } from "@/lib/queries/user-notifications";

function roleFromClaims(claims: Record<string, unknown> | undefined) {
  const metadata = claims?.user_metadata;
  if (metadata && typeof metadata === "object" && "role" in metadata) {
    const role = (metadata as { role?: unknown }).role;
    if (typeof role === "string") return role;
  }
  return undefined;
}

export async function GET() {
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

    const email =
      typeof claims.email === "string" ? claims.email : undefined;

    const result = await getUserNotificationsBySupabaseId(claims.sub, {
      email,
      role: userRole,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching notifications:", error);
    return NextResponse.json(
      { error: "Failed to fetch notifications", notifications: [], unreadCount: 0 },
      { status: 500 }
    );
  }
}

export async function PATCH() {
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

    const email =
      typeof claims.email === "string" ? claims.email : undefined;

    await markAllUserNotificationsRead(claims.sub, { email, role: userRole });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error marking notifications read:", error);
    return NextResponse.json(
      { error: "Failed to mark notifications read" },
      { status: 500 }
    );
  }
}
