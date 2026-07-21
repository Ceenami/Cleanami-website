import { db } from "@/db";
import { cleaners } from "@/db/schemas";
import { updateCleanerCoordinates } from "@/lib/services/google-maps/geocoding";
import { getAdminAuth } from "@/lib/admin-auth";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { isAdmin, error: authError } = await getAdminAuth(req);
  if (!isAdmin) {
    return NextResponse.json(
      { error: authError ?? "Unauthorized" },
      { status: 401 }
    );
  }

  const { id } = await params;
  const body = (await req.json()) as {
    address?: string;
    eligibleForAssignments?: boolean;
  };

  if (typeof body.eligibleForAssignments === "boolean") {
    await db
      .update(cleaners)
      .set({
        eligibleForAssignments: body.eligibleForAssignments,
        updatedAt: new Date(),
      })
      .where(eq(cleaners.id, id));

    return NextResponse.json({
      success: true,
      eligibleForAssignments: body.eligibleForAssignments,
    });
  }

  if (body.address) {
    await db
      .update(cleaners)
      .set({ address: body.address, updatedAt: new Date() })
      .where(eq(cleaners.id, id));
    await updateCleanerCoordinates(id);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
}
