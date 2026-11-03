import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { jobs, jobsToCleaners, reliabilityEvents } from "@/db/schemas";
import { getCleanerAuth, cleanerAuthErrorStatus } from "@/lib/cleaner-auth";
import { notifyAdminsOfJobAlert } from "@/lib/queries/cleaner-notifications";
import { recomputeReliabilityScore } from "@/lib/services/reliability/reliability.service";
import { triggerUrgentReplacement } from "@/lib/services/urgent-replacement.service";
import { and, eq } from "drizzle-orm";

/** Existing notice tiers retained; a call-out never invents a photo/pay waiver. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { cleanerId, error } = await getCleanerAuth();
  if (!cleanerId)
    return NextResponse.json(
      { error: error ?? "Unauthorized" },
      { status: cleanerAuthErrorStatus(error) },
    );
  const { id: jobId } = await params;
  if (!z.uuid().safeParse(jobId).success)
    return NextResponse.json({ error: "Invalid job" }, { status: 400 });
  try {
    const removed = await db.transaction(async (tx) => {
      const [job] = await tx
        .select()
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .for("update");
      const assignment = await tx.query.jobsToCleaners.findFirst({
        where: and(
          eq(jobsToCleaners.jobId, jobId),
          eq(jobsToCleaners.cleanerId, cleanerId),
        ),
      });
      if (!assignment) throw new Error("NOT_ASSIGNED");
      if (
        !job ||
        !["assigned", "unassigned"].includes(job.status ?? "") ||
        !job.checkInTime
      )
        throw new Error("NOT_CANCELLABLE");
      const hoursNotice = (job.checkInTime.getTime() - Date.now()) / 3600000;
      const penaltyPoints = hoursNotice <= 24 ? 10 : hoursNotice <= 48 ? 5 : 0;
      const working = ["primary", "laundry_lead"].includes(assignment.role);
      if (working)
        await tx
          .update(jobs)
          .set({ status: "unassigned", updatedAt: new Date() })
          .where(eq(jobs.id, jobId));
      await tx
        .delete(jobsToCleaners)
        .where(
          and(
            eq(jobsToCleaners.jobId, jobId),
            eq(jobsToCleaners.cleanerId, cleanerId),
          ),
        );
      if (penaltyPoints > 0)
        await tx.insert(reliabilityEvents).values({
          cleanerId,
          jobId,
          eventType: "call_out",
          penaltyPoints,
          notes: `Cancelled ${Math.max(0, Math.round(hoursNotice))}h before check-in (notice tier -${penaltyPoints})`,
        });
      return { working, penaltyPoints, hoursNotice };
    });
    if (removed.penaltyPoints > 0) {
      try {
        await recomputeReliabilityScore(cleanerId);
      } catch (error) {
        console.error("[cancel reliability refresh]", error);
      }
    }
    let outcome = "removed",
      uncoveredReason: string | null = null;
    if (removed.working) {
      try {
        const replacement = await triggerUrgentReplacement(jobId, {
          vacatedCleanerId: cleanerId,
          alreadyRemoved: true,
          recordPenalty: false,
        });
        outcome =
          replacement.outcome === "backup_promoted"
            ? "backup_promoted"
            : "uncovered";
        uncoveredReason =
          outcome === "uncovered"
            ? "Replacement offers are open; the working team is not yet complete"
            : null;
      } catch (e) {
        outcome = "uncovered";
        uncoveredReason =
          "Assignment was removed; replacement needs admin review";
        console.error("[cancel replacement]", e);
      }
      if (outcome === "uncovered")
        try {
          await notifyAdminsOfJobAlert({
            title: "Job left uncovered by a cancellation",
            message: uncoveredReason!,
            jobId,
            outcome: "cancel_uncovered",
          });
        } catch (e) {
          console.error("[cancel alert]", e);
        }
    }
    return NextResponse.json({
      success: true,
      ...removed,
      hoursNotice: Math.max(0, Math.round(removed.hoursNotice)),
      outcome,
      uncoveredReason,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    return NextResponse.json(
      {
        error:
          message === "NOT_ASSIGNED"
            ? "You are no longer assigned"
            : message === "NOT_CANCELLABLE"
              ? "This job can no longer be canceled"
              : "Failed to cancel assignment",
      },
      {
        status:
          message === "NOT_ASSIGNED"
            ? 403
            : message === "NOT_CANCELLABLE"
              ? 409
              : 500,
      },
    );
  }
}
