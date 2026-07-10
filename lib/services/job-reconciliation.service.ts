import "server-only";

import { db } from "@/db";
import { evidencePackets, jobs, payouts } from "@/db/schemas";
import { notifyAdminsOfJobAlert } from "@/lib/queries/cleaner-notifications";
import { getStartOfTodayEastern } from "@/lib/time/eastern";
import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";

const STALE_STATUSES = [
  "unassigned",
  "assigned",
  "in-progress",
  "completed_pending_evidence",
] as const;

export type JobReconciliationSummary = {
  processed: number;
  completed: number;
  awaitingCapture: number;
  canceledUncovered: number;
  alertsSent: number;
};

type JobRow = {
  id: string;
  status: string;
  checkInTime: Date | null;
  paymentStatus: string | null;
  notes: string | null;
  property: {
    address: string | null;
    bedCount: number;
    bathCount: string;
    hasHotTub: boolean;
  } | null;
  evidencePacket: {
    status: string;
    isChecklistComplete: boolean | null;
    gpsCheckInTimestamp: Date | null;
    gpsCheckOutTimestamp: Date | null;
    photoUrls: string[] | null;
  } | null;
};

function evidenceLooksComplete(evidence: JobRow["evidencePacket"]): boolean {
  if (!evidence) return false;

  if (evidence.status === "complete") {
    return true;
  }

  return Boolean(
    evidence.gpsCheckInTimestamp &&
      evidence.gpsCheckOutTimestamp &&
      evidence.isChecklistComplete &&
      (evidence.photoUrls?.length ?? 0) > 0
  );
}

function workWasStarted(
  status: string,
  evidence: JobRow["evidencePacket"]
): boolean {
  return (
    status === "in-progress" ||
    status === "completed_pending_evidence" ||
    Boolean(evidence?.gpsCheckInTimestamp)
  );
}

function appendReconciliationNote(
  existing: string | null,
  line: string
): string {
  const base = existing?.trim() ?? "";
  return base ? `${base}\n${line}` : line;
}

export async function reconcileStaleJobs(
  reference = new Date()
): Promise<JobReconciliationSummary> {
  const startOfToday = getStartOfTodayEastern(reference);
  const summary: JobReconciliationSummary = {
    processed: 0,
    completed: 0,
    awaitingCapture: 0,
    canceledUncovered: 0,
    alertsSent: 0,
  };

  const staleJobs = await db.query.jobs.findMany({
    where: and(
      inArray(jobs.status, [...STALE_STATUSES]),
      isNotNull(jobs.checkInTime),
      lt(jobs.checkInTime, startOfToday)
    ),
    with: {
      property: {
        columns: {
          address: true,
          bedCount: true,
          bathCount: true,
          hasHotTub: true,
        },
      },
      evidencePacket: {
        columns: {
          status: true,
          isChecklistComplete: true,
          gpsCheckInTimestamp: true,
          gpsCheckOutTimestamp: true,
          photoUrls: true,
        },
      },
    },
  });

  if (staleJobs.length === 0) {
    return summary;
  }

  const jobIds = staleJobs.map((j) => j.id);
  const payoutRows = await db.query.payouts.findMany({
    where: inArray(payouts.jobId, jobIds),
    columns: { jobId: true, status: true },
  });
  const payoutByJob = new Map(payoutRows.map((p) => [p.jobId, p.status]));

  const now = new Date();

  for (const job of staleJobs as JobRow[]) {
    summary.processed += 1;

    const address = job.property?.address ?? "Unknown property";
    const evidence = job.evidencePacket;
    const payoutStatus = payoutByJob.get(job.id);
    const paymentCaptured = job.paymentStatus === "captured";
    const payoutReleased = payoutStatus === "released";
    const evidenceComplete = evidenceLooksComplete(evidence);
    const started = workWasStarted(job.status, evidence);

    let nextStatus: "awaiting_capture" | "completed" | "canceled";
    let note: string;
    let alert: { title: string; message: string; outcome: string } | null =
      null;

    if (paymentCaptured || payoutReleased) {
      nextStatus = "completed";
      note = "[reconciliation] Payment captured — marked completed.";
      summary.completed += 1;
    } else if (evidenceComplete) {
      nextStatus = "awaiting_capture";
      note = "[reconciliation] Evidence complete — moved to awaiting_capture.";
      summary.awaitingCapture += 1;
    } else if (started) {
      nextStatus = "awaiting_capture";
      note =
        "[reconciliation] Service date passed with incomplete evidence — awaiting_capture.";
      summary.awaitingCapture += 1;
      alert = {
        title: "Job needs review",
        message: `Clean at ${address} was started but evidence is incomplete after the service date. Review in Job Oversight.`,
        outcome: "incomplete_evidence",
      };

      if (evidence?.gpsCheckInTimestamp && !evidence.gpsCheckOutTimestamp) {
        await db
          .update(evidencePackets)
          .set({
            gpsCheckOutTimestamp: now,
            updatedAt: now,
          })
          .where(eq(evidencePackets.jobId, job.id));
      }
    } else {
      nextStatus = "canceled";
      note =
        "[reconciliation:canceled_uncovered] No cleaner activity before end of service date.";
      summary.canceledUncovered += 1;
      alert = {
        title: "Uncovered job closed",
        message: `No cleaner covered the job at ${address} before the service date ended. Status set to canceled (uncovered).`,
        outcome: "canceled_uncovered",
      };
    }

    await db
      .update(jobs)
      .set({
        status: nextStatus,
        notes: appendReconciliationNote(job.notes, note),
        updatedAt: now,
      })
      .where(eq(jobs.id, job.id));

    if (alert) {
      await notifyAdminsOfJobAlert({
        title: alert.title,
        message: alert.message,
        jobId: job.id,
        outcome: alert.outcome,
      });
      summary.alertsSent += 1;
    }
  }

  return summary;
}
