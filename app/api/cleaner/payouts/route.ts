import { NextResponse } from "next/server";
import {
  cleanerAuthErrorStatus,
  getCleanerAuth,
} from "@/lib/cleaner-auth";
import { getCleanerPayouts } from "@/lib/queries/cleaner-payouts";

export async function GET() {
  const { cleanerId, error } = await getCleanerAuth();
  if (!cleanerId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized" },
      { status: cleanerAuthErrorStatus(error) }
    );
  }

  try {
    const data = await getCleanerPayouts(cleanerId);
    return NextResponse.json(data);
  } catch (err) {
    console.error("[GET /api/cleaner/payouts]", err);
    return NextResponse.json(
      { error: "Failed to load payouts" },
      { status: 500 }
    );
  }
}
