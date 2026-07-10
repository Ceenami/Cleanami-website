import { NextResponse } from "next/server";
import {
  cleanerAuthErrorStatus,
  getCleanerAuth,
} from "@/lib/cleaner-auth";
import { getUrgentJobOffers } from "@/lib/services/urgent-replacement.service";

export async function GET() {
  const { cleanerId, error } = await getCleanerAuth();
  if (!cleanerId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized", offers: [] },
      { status: cleanerAuthErrorStatus(error) }
    );
  }

  try {
    const offers = await getUrgentJobOffers(cleanerId);
    return NextResponse.json({ offers });
  } catch (err) {
    console.error("[GET /api/cleaner/urgent-jobs]", err);
    return NextResponse.json(
      { error: "Failed to load urgent jobs", offers: [] },
      { status: 500 }
    );
  }
}
