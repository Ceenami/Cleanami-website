import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminAuth } from "@/lib/admin-auth";
import { saveCleanerAvailability } from "@/lib/queries/cleaner-availability";
import { availabilityDaySchema } from "@/lib/scheduling/availability-policy";
import {
  buildPeriodFromMonday,
  shiftCalendarDate,
} from "@/lib/cleaner/availability-deadline";
import { triggerAssignmentEngine } from "@/lib/services/trigger-assignment-engine";

export async function POST(request: NextRequest) {
  const auth = await getAdminAuth(request);
  if (!auth.isAdmin)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = z
      .object({
        cleanerId: z.uuid(),
        day: availabilityDaySchema.extend({
          revision: z.number().int().min(0),
        }),
        reason: z.string().trim().min(3).max(500),
      })
      .strict()
      .parse(await request.json());
    shiftCalendarDate(body.day.date, 0);
    const weekday = new Date(`${body.day.date}T12:00:00Z`).getUTCDay();
    const period = buildPeriodFromMonday(
      shiftCalendarDate(body.day.date, -((weekday + 6) % 7)),
    );
    await saveCleanerAvailability(body.cleanerId, [body.day], {
      actorId: auth.actorId!,
      period,
      adminEditReason: body.reason,
    });
    void triggerAssignmentEngine();
    return NextResponse.json({
      success: true,
      message: "Availability edited. Assigned coverage remains protected.",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Availability edit failed";
    return NextResponse.json(
      { error: message },
      {
        status:
          message.startsWith("Version conflict") ||
          message.startsWith("Assigned dates")
            ? 409
            : 400,
      },
    );
  }
}
