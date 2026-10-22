import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { properties } from "@/db/schemas";
import { getAdminAuth } from "@/lib/admin-auth";
import {
  preparePropertySchedule,
  savePropertySchedule,
  ScheduleUpdateError,
} from "@/lib/services/property-schedule";

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview") }).strict(),
  z
    .object({
      action: z.literal("apply"),
      token: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAdminAuth(request);
  if (!auth.isAdmin)
    return NextResponse.json(
      { error: auth.error ?? "Unauthorized" },
      { status: 401 },
    );
  const id = z.uuid().safeParse((await params).id);
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !input.success)
    return NextResponse.json(
      { error: "Invalid schedule request." },
      { status: 400 },
    );
  try {
    const property = await db.query.properties.findFirst({
      where: eq(properties.id, id.data),
    });
    if (!property)
      return NextResponse.json(
        { error: "Property not found." },
        { status: 404 },
      );
    const prepared = await preparePropertySchedule(property);
    if (input.data.action === "preview")
      return NextResponse.json({
        success: true,
        ...prepared.plan,
        token: prepared.token,
      });
    if (prepared.token !== input.data.token)
      throw new ScheduleUpdateError(
        "The property or bookings changed since the preview. Preview again before applying.",
      );
    const result = await savePropertySchedule({
      property,
      prepared,
      patch: { updatedAt: new Date() },
      actor: auth.userId ?? "admin",
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof ScheduleUpdateError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    console.error("[property schedule] Update failed", error);
    return NextResponse.json(
      {
        error:
          "Could not update booking times. Nothing was changed; refresh and try again.",
      },
      { status: 500 },
    );
  }
}
