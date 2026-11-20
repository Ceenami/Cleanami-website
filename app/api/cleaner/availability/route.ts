import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCleanerAuth, cleanerAuthErrorStatus } from "@/lib/cleaner-auth";
import { requireCleanerAssignmentEligible } from "@/lib/cleaner/require-eligible";
import {
  getCleanerAvailability,
  saveCleanerAvailability,
  saveCleanerAvailabilityPreferences,
} from "@/lib/queries/cleaner-availability";
import { availabilityDaySchema } from "@/lib/scheduling/availability-policy";
import { triggerAssignmentEngine } from "@/lib/services/trigger-assignment-engine";
import { resolveAvailabilityWindow, availabilityGraceEnabled } from "@/lib/cleaner/availability-deadline";
export async function GET(request: Request) {
  const auth = await getCleanerAuth();
  if (!auth.cleanerId)
    return NextResponse.json(
      { error: auth.error },
      { status: cleanerAuthErrorStatus(auth.error) },
    );
  try {
    const periodStart = new URL(request.url).searchParams.get("periodStart");
    return NextResponse.json(
      await getCleanerAvailability(auth.cleanerId, periodStart),
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof RangeError
          ? error.message
          : "Failed to load availability",
      },
      { status: error instanceof RangeError ? 400 : 500 },
    );
  }
}
export async function POST(request: NextRequest) {
  const auth = await getCleanerAuth();
  if (!auth.cleanerId)
    return NextResponse.json(
      { error: auth.error },
      { status: cleanerAuthErrorStatus(auth.error) },
    );
  try {
    const { eligible } = await requireCleanerAssignmentEligible(auth.cleanerId);
    if (!eligible)
      return NextResponse.json(
        { error: "Onboarding required" },
        { status: 403 },
      );
    const periodStart = new URL(request.url).searchParams.get("periodStart");
    const { period } = resolveAvailabilityWindow(periodStart);
    const body = z
      .object({
        mode: z
          .enum(["full", "override", "preferences", "additions"])
          .default("full"),
        days: z.array(availabilityDaySchema).max(14).optional(),
        preferences: z
          .array(
            z
              .object({
                date: z.string(),
                onCallEligible: z.boolean(),
                openPoolEligible: z.boolean(),
                revision: z.number().int().optional(),
              })
              .strict(),
          )
          .max(14)
          .optional(),
      })
      .strict()
      .parse(await request.json());
    if (body.mode === "preferences") {
      if (!body.preferences?.length) throw new Error("Preferences required");
      await saveCleanerAvailabilityPreferences(
        auth.cleanerId,
        body.preferences,
        periodStart,
      );
    } else {
      if (!body.days) throw new Error("Fourteen dates required");
      await saveCleanerAvailability(auth.cleanerId, body.days, {
        actorId: auth.supabaseUserId ?? auth.cleanerId,
        additionsOnly: body.mode === "additions",
        lateCatchUp: body.mode === "override",
        period,
      });
    }
    void triggerAssignmentEngine();
    return NextResponse.json({
      success: true,
      message:
        availabilityGraceEnabled() ? "Availability saved. Assigned coverage is protected. Submission timing does not affect reliability or pay." : "Availability saved. Late additions are recorded; assigned coverage is protected.",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Save failed";
    return NextResponse.json(
      { error: message },
      { status: message.startsWith("Version conflict") ? 409 : 400 },
    );
  }
}
