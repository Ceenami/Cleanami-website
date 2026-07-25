import { NextResponse } from "next/server";
import { cleanerAuthErrorStatus, getCleanerAuth } from "@/lib/cleaner-auth";
import { listRestockRequestsForCleaner } from "@/lib/queries/restock-requests";

/** The signed-in cleaner's own restock requests and where each one got to. */
export async function GET() {
  const { cleanerId, error } = await getCleanerAuth();
  if (!cleanerId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized" },
      { status: cleanerAuthErrorStatus(error) }
    );
  }

  try {
    const requests = await listRestockRequestsForCleaner(cleanerId);
    return NextResponse.json({ requests });
  } catch (err) {
    console.error("[GET /api/cleaner/restock-requests]", err);
    return NextResponse.json(
      { error: "Failed to load restock requests" },
      { status: 500 }
    );
  }
}
