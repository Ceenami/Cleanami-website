import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminAuth } from "@/lib/admin-auth";
import { updateDisputeStatus } from "@/lib/queries/disputes";

const patchSchema = z.object({
  status: z.enum(["resolved", "denied"]),
  adminNote: z.string().max(500).optional(),
});

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
    const body = await request.json().catch(() => null);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "status must be 'resolved' or 'denied'." },
        { status: 400 }
      );
    }

    const result = await updateDisputeStatus(
      id,
      parsed.data.status,
      parsed.data.adminNote
    );
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("[PATCH /api/disputes/[id]]", err);
    const message =
      err instanceof Error ? err.message : "Failed to update dispute";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
