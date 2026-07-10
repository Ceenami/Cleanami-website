import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { cleaners, evidencePackets, jobs, jobsToCleaners } from "@/db/schemas";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;
  const userRole = user?.user_metadata?.role;

  if (userRole !== "admin" && userRole !== "super_admin") {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

  const { id: jobId } = await params;

  if (!jobId) {
    return new NextResponse("Job ID is required", { status: 400 });
  }

  console.log(`[Check-In] Starting for job: ${jobId}`);

  try {
    await db.transaction(async (tx) => {
      console.log(
        `[Check-In] Step 1: Finding primary cleaner for job ${jobId}...`
      );
      const assignments = await tx
        .select({ cleanerId: jobsToCleaners.cleanerId })
        .from(jobsToCleaners)
        .where(
          eq(jobsToCleaners.jobId, jobId) && eq(jobsToCleaners.role, "primary")
        );

      const primaryCleanerId = assignments[0]?.cleanerId;

      if (!primaryCleanerId) {
        console.error(
          `[Check-In] ERROR: No primary cleaner found for job ${jobId}. Rolling back transaction.`
        );
        throw new Error("No primary cleaner found for this job.");
      }

      console.log(`[Check-In] Found primary cleaner ID: ${primaryCleanerId}`);

      const now = new Date();

      console.log(`[Check-In] Step 2: Updating job status to 'in-progress'.`);
      await tx
        .update(jobs)
        .set({
          status: "in-progress",
          checkInTime: now,
          updatedAt: now,
        })
        .where(eq(jobs.id, jobId));

      console.log(`[Check-In] Step 3: Updating evidence packet timestamp.`);
      await tx
        .update(evidencePackets)
        .set({
          gpsCheckInTimestamp: now,
          updatedAt: now,
        })
        .where(eq(evidencePackets.jobId, jobId));

      console.log(
        `[Check-In] Step 4: Updating cleaner ${primaryCleanerId} status to 'on_job'.`
      );
      await tx
        .update(cleaners)
        .set({ onCallStatus: "on_job" })
        .where(eq(cleaners.id, primaryCleanerId));

      console.log(
        `[Check-In] Transaction for job ${jobId} completed successfully.`
      );
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error(`[Check-In] Critical error for job ${jobId}:`, errorMessage);
    return NextResponse.json(
      { error: `Failed to check in: ${errorMessage}` },
      { status: 500 }
    );
  }
}
