import { NextResponse } from "next/server";
import { cleanerAuthErrorStatus, getCleanerAuth } from "@/lib/cleaner-auth";
import { acceptSwapOffer } from "@/lib/queries/cleaner-swap";

/**
 * Takes over an open swap. Returns 409 when another cleaner got there first,
 * which the client uses to drop the offer and refresh rather than retry.
 */
export async function POST(
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
    const result = await acceptSwapOffer(cleanerId, id);

    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 409 });
    }

    return NextResponse.json({
      success: true,
      jobId: result.jobId,
      message: "You took over this clean. It's now on your schedule.",
    });
  } catch (err) {
    console.error("[POST /api/cleaner/swap-offers/[id]]", err);
    return NextResponse.json(
      { error: "Failed to accept swap" },
      { status: 500 }
    );
  }
}
