import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/admin-auth";
import { db } from "@/db";
import { swapRequests } from "@/db/schemas";
import {
  approveCleanerSwapRequest,
  denyCleanerSwapRequest,
} from "@/lib/queries/cleaner-swap";
import { eq } from "drizzle-orm";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { isAdmin, error: authError } = await getAdminAuth(request);
    if (!isAdmin) {
      return NextResponse.json(
        { error: authError ?? "Unauthorized" },
        { status: 401 }
      );
    }

    const { id } = await params;
    const { action } = (await request.json()) as { action?: string };

    if (!action || !["accept", "deny"].includes(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const targetRequest = await db.query.swapRequests.findFirst({
      where: eq(swapRequests.id, id),
      columns: { id: true },
    });

    if (!targetRequest) {
      return NextResponse.json({ error: "Swap request not found" }, { status: 404 });
    }

    if (action === "accept") {
      const result = await approveCleanerSwapRequest(id);
      if (!result.success) {
        return NextResponse.json({ error: result.message }, { status: 409 });
      }
      return NextResponse.json({
        success: true,
        outcome: result.outcome,
        replacementCleanerName:
          result.outcome === "backup_promoted"
            ? result.replacementCleanerName
            : undefined,
        notifiedCount:
          result.outcome === "released_to_pool"
            ? result.notifiedCount
            : undefined,
      });
    }

    const result = await denyCleanerSwapRequest(id);
    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 409 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating swap request:", error);
    return NextResponse.json(
      { error: "Failed to update swap request" },
      { status: 500 }
    );
  }
}
