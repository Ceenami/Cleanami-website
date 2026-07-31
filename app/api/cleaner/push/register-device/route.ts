import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { pushNotificationTokens } from "@/db/schemas";
import {
  cleanerAuthErrorStatus,
  getCleanerAuth,
} from "@/lib/cleaner-auth";

const bodySchema = z.object({
  token: z.string().min(1),
  deviceType: z.enum(["android", "ios"]),
});

/** Native (Capacitor) push registration — a raw FCM/APNs token, distinct
 * from the Web Push subscription shape `/api/cleaner/push/subscribe`
 * expects. Consumed by the Supabase Edge Function `send-push-notification`. */
export async function POST(request: NextRequest) {
  const { cleanerId, error } = await getCleanerAuth();
  if (!cleanerId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized" },
      { status: cleanerAuthErrorStatus(error) }
    );
  }

  try {
    const body = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid device token." },
        { status: 400 }
      );
    }

    const { token, deviceType } = parsed.data;
    await db
      .insert(pushNotificationTokens)
      .values({ cleanerId, token, deviceType })
      .onConflictDoUpdate({
        target: pushNotificationTokens.token,
        set: { cleanerId, deviceType, updatedAt: new Date() },
      });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[POST /api/cleaner/push/register-device]", err);
    return NextResponse.json(
      { error: "Failed to register device" },
      { status: 500 }
    );
  }
}
