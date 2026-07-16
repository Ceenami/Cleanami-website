import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminAuth } from "@/lib/admin-auth";
import {
  getPropertyRoster,
  setPropertyRoster,
} from "@/lib/queries/property-cleaners";

const rosterSchema = z.object({
  entries: z
    .array(
      z.object({
        cleanerId: z.string().uuid(),
        tier: z.enum([
          "main_primary",
          "secondary_primary",
          "preferred_backup",
          "on_call",
        ]),
        sortOrder: z.number().int().min(0).optional(),
      })
    )
    .max(50),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { isAdmin, error } = await getAdminAuth(request);
  if (!isAdmin) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }
  try {
    const { id } = await params;
    const roster = await getPropertyRoster(id);
    return NextResponse.json({ roster });
  } catch (err) {
    console.error("[GET /api/properties/[id]/cleaners]", err);
    return NextResponse.json({ error: "Failed to load roster" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { isAdmin, error } = await getAdminAuth(request);
  if (!isAdmin) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }
  try {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = rosterSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid roster payload.", issues: parsed.error.issues },
        { status: 400 }
      );
    }
    const result = await setPropertyRoster(id, parsed.data.entries);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("[PUT /api/properties/[id]/cleaners]", err);
    return NextResponse.json(
      { error: "Failed to save roster" },
      { status: 500 }
    );
  }
}
