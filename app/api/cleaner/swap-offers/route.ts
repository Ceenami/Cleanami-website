import { NextResponse } from "next/server";
import { cleanerAuthErrorStatus, getCleanerAuth } from "@/lib/cleaner-auth";
import { getOpenSwapOffers } from "@/lib/queries/cleaner-swap";

/** Open swaps this cleaner is eligible to take over. */
export async function GET() {
  const { cleanerId, error } = await getCleanerAuth();
  if (!cleanerId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized", offers: [] },
      { status: cleanerAuthErrorStatus(error) }
    );
  }

  try {
    const offers = await getOpenSwapOffers(cleanerId);
    return NextResponse.json({ offers });
  } catch (err) {
    console.error("[GET /api/cleaner/swap-offers]", err);
    return NextResponse.json(
      { error: "Failed to load swap offers", offers: [] },
      { status: 500 }
    );
  }
}
