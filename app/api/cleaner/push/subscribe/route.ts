import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { pushNotificationTokens } from "@/db/schemas";
import {
  cleanerAuthErrorStatus,
  getCleanerAuth,
} from "@/lib/cleaner-auth";

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});

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
    const parsed = subscriptionSchema.safeParse(body?.subscription ?? body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid push subscription." },
        { status: 400 }
      );
    }

    const token = JSON.stringify(parsed.data);
    await db
      .insert(pushNotificationTokens)
      .values({ cleanerId, token, deviceType: "web" })
      .onConflictDoUpdate({
        target: pushNotificationTokens.token,
        set: { cleanerId, updatedAt: new Date() },
      });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[POST /api/cleaner/push/subscribe]", err);
    return NextResponse.json(
      { error: "Failed to save push subscription" },
      { status: 500 }
    );
  }
}
