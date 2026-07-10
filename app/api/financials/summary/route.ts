import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { payouts } from "@/db/schemas";
import { sql } from "drizzle-orm";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const user = data?.claims;
    const userRole = user?.user_metadata?.role;

    if (userRole !== "admin" && userRole !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [summary] = await db.select({
      totalPaid: sql`CAST(COALESCE(SUM(${payouts.amount}) FILTER (WHERE ${payouts.status} = 'paid'), 0) AS numeric)`,
      totalPending: sql`CAST(COALESCE(SUM(${payouts.amount}) FILTER (WHERE ${payouts.status} = 'pending'), 0) AS numeric)`,
      count: sql`COUNT(${payouts.id})`,
    }).from(payouts);

    return NextResponse.json(summary);
  } catch (error) {
    console.error("Error fetching financial summary:", error);
    return NextResponse.json({ error: "Failed to fetch financial summary" }, { status: 500 });
  }
}
