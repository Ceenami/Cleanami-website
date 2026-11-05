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
import {
  CLEANER_DISPUTE_HISTORY_LIMIT,
  getCleanerDisputeHistory,
} from "@/lib/queries/cleaner-disputes";
import { eq } from "drizzle-orm";

const VALID_TYPES = ["pay", "reliability_score", "job_assignment"] as const;

/** Own history and optional related-job picker. Database calls stay sequential. */
export async function GET() {
  const { cleanerId, error } = await getCleanerAuth();
  const headers = { "Cache-Control": "private, no-store" };
  if (!cleanerId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized", jobs: [], disputes: [] },
      { status: cleanerAuthErrorStatus(error), headers }
    );
  }
  let jobs: Awaited<ReturnType<typeof getCleanerRecentJobsForDispute>> = [];
  try {
    jobs = await getCleanerRecentJobsForDispute(cleanerId);
  } catch (err) {
    console.error("[GET /api/cleaner/disputes] job picker unavailable", err);
  }
  try {
    const disputes = await getCleanerDisputeHistory(cleanerId);
    return NextResponse.json(
      { jobs, disputes, historyLimit: CLEANER_DISPUTE_HISTORY_LIMIT },
      { headers }
    );
  } catch (err) {
    console.error("[GET /api/cleaner/disputes] history unavailable", err);
    return NextResponse.json(
      {
        error: "Support history is unavailable. You can still submit a request.",
        jobs,
        disputes: [],
      },
      { status: 503, headers }
    );
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

    if (
      typeof body.description !== "string" ||
      body.description.trim().length < 10 ||
      body.description.trim().length > 2000
    ) {
      return NextResponse.json(
        { error: "Please provide a description between 10 and 2000 characters" },
        { status: 400 }
      );
    }

    // The related job is optional, and a job this cleaner was never assigned to
    // is dropped rather than rejected. Dropping is the safer failure: a bad id
    // is either tampering or a stale picker, and neither is a reason to stop
    // someone reporting a pay problem. Never trust the id the form sends —
    // `cleanerId` comes from the session, not the body.
    let jobId: string | null = null;
    const submittedJobId =
      typeof body.jobId === "string" && /^[0-9a-f-]{36}$/i.test(body.jobId.trim())
        ? body.jobId.trim()
        : null;
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
