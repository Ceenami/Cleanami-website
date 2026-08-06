import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminAuth } from "@/lib/admin-auth";
import { deleteProperty, updateProperty } from "@/lib/queries/properties";
import { deletePropertyParamsSchema } from "@/lib/validations/customer-record";
import {
  MAX_GEOFENCE_RADIUS_METERS,
  MIN_GEOFENCE_RADIUS_METERS,
} from "@/lib/constants/geofence";

// Accept HH:MM or HH:MM:SS (some browsers' <input type="time"> omit seconds);
// normalized to HH:MM:SS before storage so the column format stays consistent.
const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/;
const normalizeTime = (t: string) => (t.length === 5 ? `${t}:00` : t);

const updatePropertySchema = z
  .object({
    address: z.string().min(5).optional(),
    sqFt: z.number().int().positive().nullable().optional(),
    bedCount: z.number().int().min(1).optional(),
    // numeric column: accept a number and coerce to the string Drizzle expects
    bathCount: z
      .number()
      .min(0.5)
      .transform((n) => n.toString())
      .optional(),
    hasHotTub: z.boolean().optional(),
    laundryType: z.enum(["in_unit", "off_site", "none"]).optional(),
    laundryLoads: z.number().int().min(0).nullable().optional(),
    hotTubServiceLevel: z.boolean().optional(),
    hotTubDrain: z.boolean().optional(),
    hotTubDrainCadence: z
      .enum(["4_weeks", "6_weeks", "2_months", "3_months", "4_months"])
      .nullable()
      .optional(),
    iCalUrl: z.string().url().nullable().optional(),
    defaultCheckInTime: z.string().regex(timeRegex).transform(normalizeTime).optional(),
    defaultCheckOutTime: z.string().regex(timeRegex).transform(normalizeTime).optional(),
    // Admin price override in cents; 0 or null clears it (task 1.9).
    priceOverrideCents: z.number().int().min(0).nullable().optional(),
    /**
     * Per-property check-in fence in metres; null restores the system default.
     * Bounded here as well as by the DB CHECK because this is a payout control —
     * an unbounded radius silently removes the proof that the cleaner was ever
     * at the property.
     */
    geofenceRadiusMeters: z
      .number()
      .int()
      .min(MIN_GEOFENCE_RADIUS_METERS)
      .max(MAX_GEOFENCE_RADIUS_METERS)
      .nullable()
      .optional(),
  })
  .strict();

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { isAdmin, error } = await getAdminAuth(request);
  if (!isAdmin) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const idParsed = deletePropertyParamsSchema.safeParse({ propertyId: id });
    if (!idParsed.success) {
      return NextResponse.json(
        { error: "Invalid property id." },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = updatePropertySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid property fields.", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const result = await updateProperty(idParsed.data.propertyId, parsed.data);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("[PATCH /api/properties/[id]]", err);
    const message =
      err instanceof Error ? err.message : "Failed to update property";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { isAdmin, error } = await getAdminAuth(request);
  if (!isAdmin) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const parsed = deletePropertyParamsSchema.safeParse({ propertyId: id });

    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            "This property record looks invalid. Refresh the page and try again.",
          code: "INVALID_PROPERTY",
        },
        { status: 400 }
      );
    }

    const result = await deleteProperty(parsed.data.propertyId);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("[DELETE /api/properties/[id]]", err);
    const message =
      err instanceof Error ? err.message : "Failed to delete property";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message, code: "DELETE_BLOCKED" }, { status });
  }
}
