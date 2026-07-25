import { db } from "@/db";
import { cleaners } from "@/db/schemas";
import { updateCleanerCoordinates } from "@/lib/services/google-maps/geocoding";
import { getAdminAuth } from "@/lib/admin-auth";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

type CleanerAdminPatchBody = {
  address?: string;
  eligibleForAssignments?: boolean;
  hasHotTubCert?: boolean;
  hasLaundryLeadCert?: boolean;
};

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
  const body = (await req.json()) as CleanerAdminPatchBody;

  const patch: Partial<typeof cleaners.$inferInsert> = {};

  if (typeof body.eligibleForAssignments === "boolean") {
    patch.eligibleForAssignments = body.eligibleForAssignments;
  }

  // Certifications are admin-controlled. `hasHotTubCert` is also self-declared
  // in the cleaner's onboarding wizard, but `hasLaundryLeadCert` had no writer
  // at all before this — which meant the assignment engine's laundry-lead
  // preference never matched anyone and every off-site laundry job silently
  // fell through to the Team Leader (assignment-engine.service.ts).
  if (typeof body.hasHotTubCert === "boolean") {
    patch.hasHotTubCert = body.hasHotTubCert;
  }

  if (typeof body.hasLaundryLeadCert === "boolean") {
    patch.hasLaundryLeadCert = body.hasLaundryLeadCert;
  }

  if (typeof body.address === "string" && body.address.trim().length > 0) {
    patch.address = body.address;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 }
    );
  }

  const [updated] = await db
    .update(cleaners)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(cleaners.id, id))
    .returning({
      id: cleaners.id,
      eligibleForAssignments: cleaners.eligibleForAssignments,
      hasHotTubCert: cleaners.hasHotTubCert,
      hasLaundryLeadCert: cleaners.hasLaundryLeadCert,
    });

  if (!updated) {
    return NextResponse.json({ error: "Cleaner not found" }, { status: 404 });
  }

  // Re-geocode only after the address actually changed.
  if (patch.address !== undefined) {
    await updateCleanerCoordinates(id);
  }

  return NextResponse.json({ success: true, ...updated });
}
