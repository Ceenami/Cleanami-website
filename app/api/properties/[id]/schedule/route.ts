import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { properties } from "@/db/schemas";
import { getAdminAuth } from "@/lib/admin-auth";
import { customerAuthErrorStatus, getCustomerAuth } from "@/lib/customer-auth";
import { normalizedPropertyTimes } from "@/lib/jobs/property-schedule";
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

const time = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/);
const timesSchema = z
  .object({
    defaultCheckOutTime: time,
    defaultCheckInTime: time,
    expectedUpdatedAt: z.iso.datetime(),
  })
  .strict();

async function scheduleAccess(request: Request) {
  const admin = await getAdminAuth(request);
  if (admin.isAdmin)
    return {
      customerId: null,
      actor: admin.userId ?? "admin",
      error: null,
      status: 200,
    };
  const customer = await getCustomerAuth();
  return {
    customerId: customer.customerId,
    actor: `customer:${customer.customerId}`,
    error: customer.customerId ? null : (customer.error ?? "Unauthorized"),
    status: customerAuthErrorStatus(customer.error),
  };
}

async function scheduleProperty(id: string, customerId: string | null) {
  return db.query.properties.findFirst({
    where: and(
      eq(properties.id, id),
      customerId ? eq(properties.customerId, customerId) : undefined,
    ),
  });
}

function scheduleFailure(error: unknown) {
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await scheduleAccess(request);
  if (auth.error)
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  const id = z.uuid().safeParse((await params).id);
  const input = timesSchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !input.success)
    return NextResponse.json(
      { error: "Invalid property times." },
      { status: 400 },
    );
  try {
    const property = await scheduleProperty(id.data, auth.customerId);
    if (!property)
      return NextResponse.json(
        { error: "Property not found." },
        { status: 404 },
      );
    if (property.serviceType !== "vacation_rental_subscription")
      throw new ScheduleUpdateError(
        "Guest times can only be changed for vacation rental properties.",
        400,
      );
    if (+property.updatedAt !== Date.parse(input.data.expectedUpdatedAt))
      throw new ScheduleUpdateError(
        "The property changed while you were editing it. Refresh the page and try again.",
      );
    const after = normalizedPropertyTimes(input.data);
    // Saving the current defaults must reconcile older inherited bookings too.
    const prepared = await preparePropertySchedule(property, after);
    const updatedAt = new Date();
    const result = await savePropertySchedule({
      property,
      prepared,
      patch: { ...after, updatedAt },
      actor: auth.actor,
    });
    return NextResponse.json({
      success: true,
      ...result,
      updatedAt: updatedAt.toISOString(),
    });
  } catch (error) {
    return scheduleFailure(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await scheduleAccess(request);
  if (auth.error)
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  const id = z.uuid().safeParse((await params).id);
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !input.success)
    return NextResponse.json(
      { error: "Invalid schedule request." },
      { status: 400 },
    );
  try {
    const property = await scheduleProperty(id.data, auth.customerId);
    if (!property)
      return NextResponse.json(
        { error: "Property not found." },
        { status: 404 },
      );
    if (
      auth.customerId &&
      property.serviceType !== "vacation_rental_subscription"
    )
      throw new ScheduleUpdateError(
        "Guest times can only be changed for vacation rental properties.",
        400,
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
      actor: auth.actor,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return scheduleFailure(error);
  }
}
