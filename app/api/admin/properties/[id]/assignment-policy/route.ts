import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import {
  propertyAssignmentPolicy,
  properties,
  phase2cAudit,
} from "@/db/schemas";
import { eq, sql } from "drizzle-orm";
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
  const policy = await db.query.propertyAssignmentPolicy.findFirst({
    where: eq(propertyAssignmentPolicy.propertyId, id),
  });
  return NextResponse.json({
    hotTubRequired: policy?.hotTubRequired ?? false,
    laundryLeadRequired: policy?.laundryLeadRequired ?? false,
    adminNotes: policy?.adminNotes ?? "",
    revision: policy?.revision ?? 0,
  });
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
        hotTubRequired: z.boolean(),
        laundryLeadRequired: z.boolean(),
        adminNotes: z.string().max(3000),
        revision: z.number().int().nonnegative(),
        reason: z.string().trim().min(3).max(500),
      })
      .strict()
      .parse(await request.json());
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`checklist:${id}`},0))`,
      );
      const property = await tx.query.properties.findFirst({
        where: eq(properties.id, id),
        columns: { id: true, serviceType: true },
      });
      if (!property) throw new Error("Property not found");
      const current = await tx.query.propertyAssignmentPolicy.findFirst({
        where: eq(propertyAssignmentPolicy.propertyId, id),
      });
      if ((current?.revision ?? 0) !== body.revision)
        throw new Error("Version conflict: reload policy");
      const values = {
        hotTubRequired: body.hotTubRequired,
        laundryLeadRequired: body.laundryLeadRequired,
        adminNotes: body.adminNotes,
        revision: body.revision + 1,
        actorId: auth.actorId!,
        updatedAt: new Date(),
      };
      await tx
        .insert(propertyAssignmentPolicy)
        .values({ propertyId: id, ...values })
        .onConflictDoUpdate({
          target: propertyAssignmentPolicy.propertyId,
          set: values,
        });
      await tx.insert(phase2cAudit).values({
        subjectId: id,
        actorId: auth.actorId!,
        kind: "property_assignment_policy",
        payload: body,
      });
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Save failed" },
      {
        status:
          e instanceof Error && e.message.startsWith("Version conflict")
            ? 409
            : 400,
      },
    );
  }
}
