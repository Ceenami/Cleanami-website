import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { jobs } from "@/db/schemas";
import {
  cleanerAuthErrorStatus,
  getCleanerAuth,
  requireCleanerJobAssignment,
} from "@/lib/cleaner-auth";
import { recordGpsLog, type DeviceLocation } from "@/lib/services/gps/geofence";
import { eq } from "drizzle-orm";

const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative().nullable().optional(),
});

/**
 * Periodic background-location point while a cleaner is checked in
 * (`activityType: 'working'`, distinct from the one-shot 'arrival'/'departure'
 * points check-in/check-out already record). Only accepted while the job is
 * actually in progress — tracking window is check-in-through-checkout only.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { cleanerId, error } = await getCleanerAuth();
  if (!cleanerId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized" },
      { status: cleanerAuthErrorStatus(error) }
    );
  }

  const { id: jobId } = await params;
  const { error: assignmentError } = await requireCleanerJobAssignment(
    cleanerId,
    jobId
  );

  if (assignmentError) {
    return NextResponse.json({ error: assignmentError }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => null);
    const parsed = locationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid location." },
        { status: 400 }
      );
    }

    const job = await db.query.jobs.findFirst({
      where: eq(jobs.id, jobId),
      columns: { status: true },
    });

    if (job?.status !== "in-progress") {
      return NextResponse.json(
        { error: "Job is not in progress." },
        { status: 409 }
      );
    }

    const device: DeviceLocation = parsed.data;
    await recordGpsLog({
      jobId,
      cleanerId,
      device,
      activityType: "working",
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[POST /api/cleaner/jobs/[id]/gps-ping]", err);
    return NextResponse.json(
      { error: "Failed to record location" },
      { status: 500 }
    );
  }
}
