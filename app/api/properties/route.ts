import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createProperty, getPropertiesWithOwner } from "@/lib/queries/properties";
import {
  customerAuthErrorStatus,
  getCustomerAuth,
  resolvePortalCustomerScope,
} from "@/lib/customer-auth";
import { getSessionRole } from "@/lib/auth/server-roles";

export async function GET(request: NextRequest) {
  try {
    const scope = await resolvePortalCustomerScope(request);
    if (scope.error) {
      return NextResponse.json(
        { error: scope.error, data: [], nextPage: null },
        { status: customerAuthErrorStatus(scope.error) }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "10");
    const query = searchParams.get("query") || "";

    const result = await getPropertiesWithOwner({
      page,
      limit,
      query,
      customerId: scope.customerId,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching properties:", error);
    return NextResponse.json(
      { error: "Failed to fetch properties" },
      { status: 500 }
    );
  }
}

// Accept HH:MM or HH:MM:SS (some browsers' <input type="time"> omit seconds);
// normalized before storage so the column format stays consistent.
const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/;
const normalizeTime = (t: string) => (t.length === 5 ? `${t}:00` : t);

const createPropertySchema = z
  .object({
    address: z.string().trim().min(5),
    bedCount: z.number().int().min(1),
    // numeric column: accept a number, coerce to the string Drizzle expects
    bathCount: z.number().min(0.5).transform((n) => n.toString()),
    sqFt: z.number().int().positive().nullable().optional(),
    hasHotTub: z.boolean().optional(),
    laundryType: z.enum(["in_unit", "off_site", "none"]),
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
    /** Admin only. A customer's property is always created under themselves. */
    customerId: z.string().uuid().optional(),
  })
  .strict();

/**
 * Creates a property.
 *
 * Ownership is decided here, never taken from the body for a customer: an
 * admin may name any `customerId`, a customer always gets their own regardless
 * of what they send. Without that, the field would be an open invitation to
 * attach a property to someone else's account.
 */
export async function POST(request: NextRequest) {
  const userRole = await getSessionRole();
  const isAdmin = userRole === "admin" || userRole === "super_admin";
  const isCustomer = userRole === "user";

  if (!isAdmin && !isCustomer) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = createPropertySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid property fields.", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  let customerId: string;
  if (isAdmin) {
    if (!parsed.data.customerId) {
      return NextResponse.json(
        { error: "customerId is required when creating a property as an admin." },
        { status: 400 }
      );
    }
    customerId = parsed.data.customerId;
  } else {
    const auth = await getCustomerAuth();
    if (!auth.customerId) {
      return NextResponse.json(
        { error: auth.error ?? "Unauthorized" },
        { status: customerAuthErrorStatus(auth.error) }
      );
    }
    customerId = auth.customerId;
  }

  try {
    // Drop the body's customerId — `customerId` above is the authorised one.
    const fields = { ...parsed.data };
    delete fields.customerId;
    const result = await createProperty({ ...fields, customerId });

    return NextResponse.json(
      {
        success: true,
        propertyId: result.propertyId,
        geocoded: result.geocoded,
        // Surfaced rather than swallowed: an ungeocoded property makes every
        // check-in there "unknown" to the geofence, so it is allowed and
        // flagged instead of enforced.
        warning: result.geocoded
          ? undefined
          : "We could not locate that address on the map. The property was saved, but check-in location cannot be verified until the address is corrected.",
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[POST /api/properties]", err);
    const message =
      err instanceof Error ? err.message : "Failed to create property";
    return NextResponse.json(
      { error: message },
      { status: message.includes("not found") ? 404 : 400 }
    );
  }
}
