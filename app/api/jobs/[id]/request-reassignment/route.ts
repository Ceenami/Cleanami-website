import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { jobs } from "@/db/schemas";
import { eq } from "drizzle-orm";
import { assignJob } from "@/lib/services/assignment/assignment-engine.service";

export const runtime = "nodejs";

/**
 * Cleaner-app reassignment nudge. When a cleaner cancels out of a job the app
 * sets it back to `unassigned`; this runs the assignment engine for that single
 * job right away instead of leaving it for the 4-hourly cron, which can miss a
 * last-minute cancellation. Authenticated by the shared cleaner-app API key —
 * the same key the capture route uses.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const expectedKey = process.env.CLEANER_APP_API_KEY;
  if (!expectedKey) {
    return NextResponse.json(
      { error: "Reassignment endpoint is not configured" },
      { status: 503 }
    );
  }

  const apiKey = req.headers.get("x-api-key");
  if (!apiKey || apiKey !== expectedKey) {
    return NextResponse.json(
      { error: "Unauthorized: Invalid or missing API key" },
      { status: 401 }
    );
  }

  try {
    const { id } = await params;
    const job = await db.query.jobs.findFirst({
      where: eq(jobs.id, id),
      columns: {
        id: true,
        propertyId: true,
        checkInTime: true,
        expectedHours: true,
        addonsSnapshot: true,
        status: true,
      },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Only touch a genuinely open job. Anything else (still has cleaners,
    // already completed/cancelled) is a no-op, so a replayed or spurious call —
    // the API key is bundled in the app — cannot disturb an assigned job.
    if (job.status !== "unassigned") {
      return NextResponse.json({ skipped: true, reason: `job is ${job.status}` });
    }

    const outcome = await assignJob({
      id: job.id,
      propertyId: job.propertyId,
      checkInTime: job.checkInTime,
      expectedHours: job.expectedHours,
      addonsSnapshot: job.addonsSnapshot,
    });

    return NextResponse.json({ outcome });
  } catch (error) {
    console.error("[request-reassignment]", error);
    return NextResponse.json(
      { error: "Failed to trigger reassignment" },
      { status: 500 }
    );
  }
}
