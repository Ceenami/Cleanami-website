import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminAuth } from "@/lib/admin-auth";
import { getAppUserIdForSupabaseUser } from "@/lib/auth/server-roles";
import { updateRestockRequestStatus } from "@/lib/queries/restock-requests";
import { RESTOCK_STATUSES } from "@/db/schemas";

const bodySchema = z.object({
  status: z.enum(RESTOCK_STATUSES),
  adminNotes: z.string().trim().max(500).nullable().optional(),
});

/** Admin moves a restock request along the queue (task 1.16). */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { isAdmin, error } = await getAdminAuth(request);
  if (!isAdmin) {
    return NextResponse.json(
      { error: error ?? "Unauthorized" },
      { status: 401 }
    );
  }

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid request id." }, { status: 400 });
  }

  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid status." },
        { status: 400 }
      );
    }

    const result = await updateRestockRequestStatus({
      id,
      status: parsed.data.status,
      adminNotes: parsed.data.adminNotes,
      resolvedByUserId: await getAppUserIdForSupabaseUser(),
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[PATCH /api/restock-requests/[id]]", err);
    return NextResponse.json(
      { error: "Failed to update restock request" },
      { status: 500 }
    );
  }
}
