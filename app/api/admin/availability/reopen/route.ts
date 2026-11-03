import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { availability, availabilityDays, phase2cAudit } from "@/db/schemas";
import { and, eq, sql } from "drizzle-orm";
import { getAdminAuth } from "@/lib/admin-auth";
import {
  shiftCalendarDate,
  easternToday,
} from "@/lib/cleaner/availability-deadline";
export async function POST(request: NextRequest) {
  const auth = await getAdminAuth(request);
  if (!auth.isAdmin)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = z
      .object({
        cleanerId: z.uuid(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        reason: z.string().trim().min(3).max(500),
      })
      .strict()
      .parse(await request.json());
    shiftCalendarDate(body.date, 0);
    if (body.date < easternToday()) throw new Error("Cannot reopen past dates");
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`cleaner:${body.cleanerId}:${body.date}`},0))`,
      );
      const old = await tx.query.availability.findFirst({
        where: and(
          eq(availability.cleanerId, body.cleanerId),
          eq(availability.date, body.date),
        ),
      });
      const until = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await tx
        .insert(availabilityDays)
        .values({
          cleanerId: body.cleanerId,
          date: body.date,
          isAvailable: !!old,
          onCallEligible: old?.onCallEligible ?? false,
          openPoolEligible: old?.openPoolEligible ?? false,
          actorId: auth.actorId!,
          reopenedUntil: until,
        })
        .onConflictDoUpdate({
          target: [availabilityDays.cleanerId, availabilityDays.date],
          set: {
            reopenedUntil: until,
            revision: sql`${availabilityDays.revision}+1`,
            actorId: auth.actorId!,
            updatedAt: new Date(),
          },
        });
      await tx.insert(phase2cAudit).values({
        subjectId: body.cleanerId,
        actorId: auth.actorId!,
        kind: "availability_reopened",
        payload: {
          date: body.date,
          reason: body.reason,
          until: until.toISOString(),
        },
      });
    });
    return NextResponse.json({
      success: true,
      message: "Reopened for 24 hours. Assigned coverage remains protected.",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Reopen failed" },
      { status: 400 },
    );
  }
}
