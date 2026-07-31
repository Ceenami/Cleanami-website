import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { evidencePackets, jobs } from "@/db/schemas";
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
  /**
   * When the fix was taken, for points the app buffered while the device was
   * asleep. Android suspends WebView JS in the background, so the app's
   * background runner captures fixes natively and can only upload them once the
   * app next wakes — often after check-out. Without this the whole backgrounded
   * portion of a shift is unrecordable.
   */
  capturedAt: z.string().datetime().optional(),
});

/** How far in the past a buffered point may be and still be accepted. Bounds
 * the damage from a device with a badly wrong clock without rejecting the
 * ordinary case of an app that stayed asleep for most of a shift. */
const MAX_BACKFILL_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Periodic background-location point while a cleaner is checked in
 * (`activityType: 'working'`, distinct from the one-shot 'arrival'/'departure'
 * points check-in/check-out already record). Accepted while the job is in
 * progress, or — for a point carrying `capturedAt` — if that capture time falls
 * inside the job's own check-in/check-out window.
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

    const now = new Date();
    let capturedAt: Date | undefined;

    if (parsed.data.capturedAt) {
      capturedAt = new Date(parsed.data.capturedAt);
      if (
        capturedAt.getTime() > now.getTime() ||
        now.getTime() - capturedAt.getTime() > MAX_BACKFILL_AGE_MS
      ) {
        return NextResponse.json(
          { error: "Invalid capture time." },
          { status: 400 }
        );
      }
    }

    const job = await db.query.jobs.findFirst({
      where: eq(jobs.id, jobId),
      columns: { status: true },
    });

    if (job?.status !== "in-progress") {
      // A buffered point is still legitimate after check-out — it records where
      // the cleaner was *during* the job. Accept it if its capture time lands
      // inside the recorded working window; reject anything else.
      const packet = capturedAt
        ? await db.query.evidencePackets.findFirst({
            where: eq(evidencePackets.jobId, jobId),
            columns: {
              gpsCheckInTimestamp: true,
              gpsCheckOutTimestamp: true,
            },
          })
        : null;

      const checkedInAt = packet?.gpsCheckInTimestamp ?? null;
      const checkedOutAt = packet?.gpsCheckOutTimestamp ?? now;
      const withinWorkingWindow =
        capturedAt != null &&
        checkedInAt != null &&
        capturedAt >= checkedInAt &&
        capturedAt <= checkedOutAt;

      if (!withinWorkingWindow) {
        return NextResponse.json(
          { error: "Job is not in progress." },
          { status: 409 }
        );
      }
    }

    const device: DeviceLocation = {
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      accuracy: parsed.data.accuracy,
    };
    await recordGpsLog({
      jobId,
      cleanerId,
      device,
      activityType: "working",
      capturedAt,
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
