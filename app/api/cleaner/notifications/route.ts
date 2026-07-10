import { NextResponse } from "next/server";
import {
  cleanerAuthErrorStatus,
  getCleanerAuth,
} from "@/lib/cleaner-auth";
import {
  getCleanerNotifications,
  markAllNotificationsRead,
} from "@/lib/queries/cleaner-notifications";

export async function GET() {
  const { cleanerId, error } = await getCleanerAuth();
  if (!cleanerId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized", notifications: [], unreadCount: 0 },
      { status: cleanerAuthErrorStatus(error) }
    );
  }

  try {
    const data = await getCleanerNotifications(cleanerId, 20);
    return NextResponse.json(data);
  } catch (err) {
    console.error("[GET /api/cleaner/notifications]", err);
    return NextResponse.json(
      { error: "Failed to load notifications", notifications: [], unreadCount: 0 },
      { status: 500 }
    );
  }
}

export async function PATCH() {
  const { cleanerId, error } = await getCleanerAuth();
  if (!cleanerId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized" },
      { status: cleanerAuthErrorStatus(error) }
    );
  }

  try {
    await markAllNotificationsRead(cleanerId);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[PATCH /api/cleaner/notifications]", err);
    return NextResponse.json(
      { error: "Failed to mark notifications read" },
      { status: 500 }
    );
  }
}
