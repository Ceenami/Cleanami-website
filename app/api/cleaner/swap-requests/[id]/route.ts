import { NextResponse } from "next/server";
import { cleanerAuthErrorStatus, getCleanerAuth } from "@/lib/cleaner-auth";
import { cancelCleanerSwapRequest } from "@/lib/queries/cleaner-swap";

/** Withdraws a swap request the cleaner raised, while it is still pending. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { cleanerId, error } = await getCleanerAuth();
  if (!cleanerId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized" },
      { status: cleanerAuthErrorStatus(error) }
    );
  }

  const { id } = await params;

  try {
    const result = await cancelCleanerSwapRequest(cleanerId, id);

    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[DELETE /api/cleaner/swap-requests/[id]]", err);
    return NextResponse.json(
      { error: "Failed to withdraw swap request" },
      { status: 500 }
    );
  }
}
