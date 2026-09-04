import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { cleaners, disputes } from "@/db/schemas";
import {
  cleanerAuthErrorStatus,
  getCleanerAuth,
} from "@/lib/cleaner-auth";
import { notifyAdminsOfDispute } from "@/lib/queries/cleaner-notifications";
import {
  getCleanerRecentJobsForDispute,
  isJobAssignedToCleaner,
} from "@/lib/queries/cleaner-jobs";
import { eq } from "drizzle-orm";

const VALID_TYPES = ["pay", "reliability_score", "job_assignment"] as const;

/** The jobs this cleaner may attach to a support request. */
export async function GET() {
  const { cleanerId, error } = await getCleanerAuth();
  if (!cleanerId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized", jobs: [] },
      { status: cleanerAuthErrorStatus(error) }
    );
  }

  try {
    const jobs = await getCleanerRecentJobsForDispute(cleanerId);
    return NextResponse.json({ jobs });
  } catch (err) {
    console.error("[GET /api/cleaner/disputes]", err);
    // The picker is optional, so a failure here must not stop a cleaner
    // filing: the form falls back to submitting with no job attached.
    return NextResponse.json({ jobs: [] });
  }
}

export async function POST(request: NextRequest) {
  const { cleanerId, error } = await getCleanerAuth();
  if (!cleanerId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized" },
      { status: cleanerAuthErrorStatus(error) }
    );
  }

  try {
    const body = (await request.json()) as {
      type?: string;
      description?: string;
      jobId?: string | null;
    };

    if (
      !body.type ||
      !VALID_TYPES.includes(body.type as (typeof VALID_TYPES)[number])
    ) {
      return NextResponse.json(
        { error: "Valid dispute type is required" },
        { status: 400 }
      );
    }

    if (!body.description?.trim() || body.description.trim().length < 10) {
      return NextResponse.json(
        { error: "Please provide a description (at least 10 characters)" },
        { status: 400 }
      );
    }

    // The related job is optional, and a job this cleaner was never assigned to
    // is dropped rather than rejected. Dropping is the safer failure: a bad id
    // is either tampering or a stale picker, and neither is a reason to stop
    // someone reporting a pay problem. Never trust the id the form sends —
    // `cleanerId` comes from the session, not the body.
    let jobId: string | null = null;
    const submittedJobId = body.jobId?.trim();
    if (submittedJobId) {
      const owned = await isJobAssignedToCleaner(cleanerId, submittedJobId);
      if (owned) {
        jobId = submittedJobId;
      } else {
        console.warn(
          `[POST /api/cleaner/disputes] cleaner ${cleanerId} referenced job ${submittedJobId} they are not assigned to; storing null`
        );
      }
    }

    const cleaner = await db.query.cleaners.findFirst({
      where: eq(cleaners.id, cleanerId),
      columns: { fullName: true },
    });

    const [dispute] = await db
      .insert(disputes)
      .values({
        cleanerId,
        type: body.type as (typeof VALID_TYPES)[number],
        description: body.description.trim(),
        status: "pending",
        jobId,
      })
      .returning();

    // Best-effort, and it must stay that way. The row above is already
    // committed, so a throw here would tell the cleaner their submission failed
    // while an admin watches it arrive. In production `notifications` carries an
    // AFTER INSERT trigger that calls an Edge Function over HTTP; a trigger
    // error is a statement error, and unwrapped it would propagate straight out
    // of this route. Every other notification path in this codebase already
    // swallows its own failures.
    try {
      if (cleaner) {
        await notifyAdminsOfDispute(cleaner.fullName, body.type);
      }
    } catch (err) {
      console.error(
        "[POST /api/cleaner/disputes] admin notification failed; the dispute was still saved",
        err
      );
    }

    return NextResponse.json({
      success: true,
      disputeId: dispute.id,
      message:
        "Your dispute has been submitted. We'll respond within 48 hours.",
    });
  } catch (err) {
    console.error("[POST /api/cleaner/disputes]", err);
    return NextResponse.json(
      { error: "Failed to submit dispute" },
      { status: 500 }
    );
  }
}
