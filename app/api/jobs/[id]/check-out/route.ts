import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { jobs, evidencePackets } from "@/db/schemas";
import { eq } from "drizzle-orm";
import { getAdminAuth } from "@/lib/admin-auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { isAdmin, error: authError } = await getAdminAuth(request);
    if (!isAdmin) {
      return NextResponse.json(
        { error: authError ?? "Unauthorized" },
        { status: 401 }
      );
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
