import { NextResponse } from "next/server";
import { db } from "@/db";
import { jobs, jobsToCleaners, notifications, reliabilityEvents } from "@/db/schemas";
import {
  cleanerAuthErrorStatus,
  getCleanerAuth,
  requireCleanerJobAssignment,
} from "@/lib/cleaner-auth";
import { getCleanerUserId } from "@/lib/queries/cleaner-notifications";
import { recomputeReliabilityScore } from "@/lib/services/reliability/reliability.service";
import { assignJob } from "@/lib/services/assignment/assignment-engine.service";
import { and, eq } from "drizzle-orm";

const CANCELLABLE_STATUSES = new Set(["unassigned", "assigned"]);

/**
 * Cleaner-initiated cancellation notice tiers (spec §13.2 / decision D5): the
 * server allows cancellation at any notice — it never blocks — but prices it.
 * >48h is neutral, 24-48h is -5, <24h is -10. `reliabilityEvents.penaltyPoints`
 * is informational for a `call_out` event (the score itself is a rolling
 * honored/assigned ratio — see reliability.service.ts), so these numbers are
 * an audit-trail record of the tier, not a literal score decrement.
 */
const SHORT_NOTICE_HOURS = 48;
const LATE_NOTICE_HOURS = 24;
const LATE_NOTICE_PENALTY = 5;
const VERY_LATE_NOTICE_PENALTY = 10;

async function notifyCleaner(
  cleanerId: string,
  title: string,
  message: string,
  jobId: string
) {
  const userId = await getCleanerUserId(cleanerId);
  if (!userId) return;

  await db.insert(notifications).values({
    userId,
    type: "urgent_job",
    title,
    message,
    jobId,
    metadata: { source: "cleaner_cancel" },
  });
}

export async function POST(
  _request: Request,
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
  const { assignment, error: assignmentError } = await requireCleanerJobAssignment(
    cleanerId,
    jobId
  );

  if (assignmentError || !assignment) {
    return NextResponse.json(
      { error: assignmentError ?? "Not assigned to this job" },
      { status: 403 }
    );
  }

  try {
    const job = await db.query.jobs.findFirst({
      where: eq(jobs.id, jobId),
      with: {
        property: { columns: { address: true } },
        cleaners: {
          with: { cleaner: { columns: { id: true, fullName: true } } },
        },
      },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (!job.status || !CANCELLABLE_STATUSES.has(job.status)) {
      return NextResponse.json(
        {
          error:
            "This job can no longer be cancelled — cleaning may already be in progress or complete.",
        },
        { status: 409 }
      );
    }

    if (!job.checkInTime) {
      return NextResponse.json(
        { error: "This job has no scheduled start time." },
        { status: 400 }
      );
    }

    const now = new Date();
    const hoursNotice =
      (job.checkInTime.getTime() - now.getTime()) / (1000 * 60 * 60);

    let penaltyPoints = 0;
    let tierLabel = ">48h";
    if (hoursNotice <= LATE_NOTICE_HOURS) {
      penaltyPoints = VERY_LATE_NOTICE_PENALTY;
      tierLabel = "<24h";
    } else if (hoursNotice <= SHORT_NOTICE_HOURS) {
      penaltyPoints = LATE_NOTICE_PENALTY;
      tierLabel = "24-48h";
    }

    const role = assignment.role;
    const address = job.property?.address ?? "the property";

    await db
      .delete(jobsToCleaners)
      .where(
        and(eq(jobsToCleaners.jobId, jobId), eq(jobsToCleaners.cleanerId, cleanerId))
      );

    if (penaltyPoints > 0) {
      await db.insert(reliabilityEvents).values({
        cleanerId,
        jobId,
        eventType: "call_out",
        penaltyPoints,
        notes: `Cancelled ${Math.max(0, Math.round(hoursNotice))}h before check-in (${tierLabel} notice, -${penaltyPoints})`,
      });
      await recomputeReliabilityScore(cleanerId);
    }

    let outcome: "backup_promoted" | "reassignment_triggered" | "removed" =
      "removed";

    if (role === "primary") {
      const backup = job.cleaners.find(
        (c) => c.role === "backup" && c.cleanerId !== cleanerId
      );

      if (backup) {
        await db
          .update(jobsToCleaners)
          .set({
            role: "primary",
            urgentBonus: tierLabel === "<24h" ? true : backup.urgentBonus,
            updatedAt: now,
          })
          .where(
            and(
              eq(jobsToCleaners.jobId, jobId),
              eq(jobsToCleaners.cleanerId, backup.cleanerId)
            )
          );

        await db
          .update(jobs)
          .set({ status: "assigned", updatedAt: now })
          .where(eq(jobs.id, jobId));

        await notifyCleaner(
          backup.cleanerId,
          "You are now primary",
          `A cancellation moved you up to primary for ${address}.${
            tierLabel === "<24h" ? " Includes a $10 urgent bonus." : ""
          }`,
          jobId
        );

        outcome = "backup_promoted";
      } else {
        await db
          .update(jobs)
          .set({ status: "unassigned", updatedAt: now })
          .where(eq(jobs.id, jobId));

        await assignJob({
          id: job.id,
          propertyId: job.propertyId,
          checkInTime: job.checkInTime,
          expectedHours: job.expectedHours,
          addonsSnapshot: job.addonsSnapshot,
        });

        outcome = "reassignment_triggered";
      }
    }

    return NextResponse.json({
      success: true,
      penaltyPoints,
      hoursNotice: Math.max(0, Math.round(hoursNotice)),
      outcome,
    });
  } catch (err) {
    console.error("[POST /api/cleaner/jobs/[id]/cancel]", err);
    return NextResponse.json(
      { error: "Failed to cancel job" },
      { status: 500 }
    );
  }
}
