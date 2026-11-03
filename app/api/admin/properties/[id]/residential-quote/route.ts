import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { properties } from "@/db/schemas";
import { getAdminAuth } from "@/lib/admin-auth";
import { evaluateResidentialSale } from "@/lib/pricing/residential-sales";
import { toPublicResidentialQuote } from "@/lib/pricing/residential";
const schema = z
  .object({
    cleaningLevel: z.enum(["standard", "deep"]),
    hotTub: z.enum(["none", "basic", "full"]),
    inUnitLaundryLoads: z.number().int().min(0).max(2),
  })
  .strict();
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (!(await getAdminAuth(request)).isAdmin)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!z.uuid().safeParse(id).success)
      return NextResponse.json({ error: "Invalid property" }, { status: 400 });
    const input = schema.safeParse(await request.json().catch(() => null));
    if (!input.success)
      return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
    const property = await db.query.properties.findFirst({
      where: eq(properties.id, id),
    });
    if (!property || property.serviceType !== "residential_one_time")
      return NextResponse.json(
        { error: "Property not found" },
        { status: 404 },
      );
    const result = evaluateResidentialSale({
      ...input.data,
      bedrooms: property.bedCount,
      bathrooms: Number(property.bathCount),
      sqft: property.sqFt,
      petsAllowed: property.petsAllowed,
    });
    return NextResponse.json(
      result.ok
        ? toPublicResidentialQuote(result.terms)
        : { refused: true, message: result.error },
    );
  } catch {
    return NextResponse.json({ error: "Quote unavailable" }, { status: 503 });
  }
}
