import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const user = data?.claims;
    const userRole = user?.user_metadata?.role;

    if (userRole !== "admin" && userRole !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
          result.outcome === "awaiting_accept" ? result.notifiedCount : undefined,
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
