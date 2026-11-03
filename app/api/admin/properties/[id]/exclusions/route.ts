import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import {
  propertyExclusions,
  propertyCleaners,
  phase2cAudit,
} from "@/db/schemas";
import { and, eq, sql } from "drizzle-orm";
import { getAdminAuth } from "@/lib/admin-auth";
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getAdminAuth(request)).isAdmin)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success)
    return NextResponse.json({ error: "Invalid property" }, { status: 400 });
  return NextResponse.json(
    await db
      .select()
      .from(propertyExclusions)
      .where(eq(propertyExclusions.propertyId, id)),
  );
}
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAdminAuth(request);
  if (!auth.isAdmin)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await params;
    z.uuid().parse(id);
    const body = z
      .object({
        cleanerId: z.uuid(),
        excluded: z.boolean(),
        reason: z.string().trim().min(3).max(500),
      })
      .strict()
      .parse(await request.json());
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`property:${id}`},0))`,
      );
      if (body.excluded) {
        const roster = await tx.query.propertyCleaners.findFirst({
          where: and(
            eq(propertyCleaners.propertyId, id),
            eq(propertyCleaners.cleanerId, body.cleanerId),
          ),
        });
        if (roster)
          throw new Error(
            "This cleaner is on the property roster. Remove that roster entry before adding a hard exclusion.",
          );
        await tx
          .insert(propertyExclusions)
          .values({
            propertyId: id,
            cleanerId: body.cleanerId,
            reason: body.reason,
            actorId: auth.actorId!,
          })
          .onConflictDoUpdate({
            target: [
              propertyExclusions.propertyId,
              propertyExclusions.cleanerId,
            ],
            set: { reason: body.reason, actorId: auth.actorId! },
          });
      } else
        await tx
          .delete(propertyExclusions)
          .where(
            and(
              eq(propertyExclusions.propertyId, id),
              eq(propertyExclusions.cleanerId, body.cleanerId),
            ),
          );
      await tx.insert(phase2cAudit).values({
        subjectId: id,
        kind: "property_exclusion",
        actorId: auth.actorId!,
        payload: body,
      });
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Save failed" },
      { status: 409 },
    );
  }
}
