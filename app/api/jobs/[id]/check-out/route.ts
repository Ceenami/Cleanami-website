import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { jobs, evidencePackets } from "@/db/schemas";
import { eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";

export async function POST(
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

    await db
      .update(jobs)
      .set({
        status: "completed",
        checkOutTime: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, id));

    await db
      .update(evidencePackets)
      .set({
        gpsCheckOutTimestamp: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(evidencePackets.jobId, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error checking out:", error);
    return NextResponse.json({ error: "Failed to check out" }, { status: 500 });
  }
}
