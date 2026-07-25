import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { payouts } from "@/db/schemas";
import { sql } from "drizzle-orm";
import { getAdminAuth } from "@/lib/admin-auth";

export async function GET(request: NextRequest) {
  try {
    const { isAdmin, error } = await getAdminAuth(request);
    if (!isAdmin) {
      return NextResponse.json(
        { error: error ?? "Unauthorized" },
        { status: 401 }
      );
    }

    // Payout status enum is pending | released | held (see payouts.schema.ts).
    // The payout cron writes 'released' on success — NOT 'paid' — so summing on
    // 'paid' always returned $0. Sum released payouts as "Total Paid".
    const [summary] = await db.select({
      totalPaid: sql`CAST(COALESCE(SUM(${payouts.amount}) FILTER (WHERE ${payouts.status} = 'released'), 0) AS numeric)`,
      totalPending: sql`CAST(COALESCE(SUM(${payouts.amount}) FILTER (WHERE ${payouts.status} = 'pending'), 0) AS numeric)`,
      totalHeld: sql`CAST(COALESCE(SUM(${payouts.amount}) FILTER (WHERE ${payouts.status} = 'held'), 0) AS numeric)`,
      count: sql`COUNT(${payouts.id})`,
    }).from(payouts);

    return NextResponse.json(summary);
  } catch (error) {
    console.error("Error fetching financial summary:", error);
    return NextResponse.json({ error: "Failed to fetch financial summary" }, { status: 500 });
  }
}
