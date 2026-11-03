import "server-only";
import { db } from "@/db";
import { cleaners, evidencePackets, jobs, jobsToCleaners } from "@/db/schemas";
import { and, eq, inArray, sql } from "drizzle-orm";

export class JobVisitError extends Error {
  constructor(
    message: string,
    public status: 403 | 404 | 409,
  ) {
    super(message);
  }
}

type VisitInput = {
  jobId: string;
  cleanerId?: string;
  now: Date;
  gpsFields?: Partial<typeof evidencePackets.$inferInsert>;
  expectedSchedule?: { start: Date | null; deadline: Date | null };
};

/** Preserve scheduled times and first visit timestamps under retries/races. */
export async function recordJobArrival(input: VisitInput) {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select({ status: jobs.status, start: jobs.checkInTime, deadline: jobs.checkOutTime })
      .from(jobs)
      .where(eq(jobs.id, input.jobId))
      .for("update");
    if (!job) throw new JobVisitError("Job not found", 404);
    if (input.expectedSchedule && (
      job.start?.getTime() !== input.expectedSchedule.start?.getTime() ||
      job.deadline?.getTime() !== input.expectedSchedule.deadline?.getTime()
    )) throw new JobVisitError("The booking changed while you were checking in. Refresh and try again.", 409);
    const working = await tx
      .select({ cleanerId: jobsToCleaners.cleanerId })
      .from(jobsToCleaners)
      .where(
        and(
          eq(jobsToCleaners.jobId, input.jobId),
          inArray(jobsToCleaners.role, ["primary", "laundry_lead"]),
        ),
      );
    if (
      !working.length ||
      (input.cleanerId && !working.some((c) => c.cleanerId === input.cleanerId))
    )
      throw new JobVisitError("Only the working team may record arrival", 403);
    const packet = await tx.query.evidencePackets.findFirst({
      where: eq(evidencePackets.jobId, input.jobId),
    });
    if (
      job.status === "in-progress" &&
      packet?.gpsCheckInTimestamp &&
      !packet.gpsCheckOutTimestamp &&
      !packet.finalEvidenceSubmittedAt
    )
      return { started: false };
    if (
      job.status !== "assigned" ||
      packet?.gpsCheckOutTimestamp ||
      packet?.finalEvidenceSubmittedAt
    )
      throw new JobVisitError(
        "Only an assigned job can start; departed or finalized jobs cannot be reopened",
        409,
      );
    await tx
      .update(jobs)
      .set({ status: "in-progress", updatedAt: input.now })
      .where(eq(jobs.id, input.jobId));
    const arrival = packet?.gpsCheckInTimestamp ?? input.now;
    if (packet) {
      await tx
        .update(evidencePackets)
        .set({
          ...input.gpsFields,
          gpsCheckInTimestamp: arrival,
          updatedAt: input.now,
        })
        .where(eq(evidencePackets.jobId, input.jobId));
    } else {
      await tx.insert(evidencePackets).values({
        ...input.gpsFields,
        jobId: input.jobId,
        status: "incomplete",
        gpsCheckInTimestamp: arrival,
      });
    }
    await tx
      .update(cleaners)
      .set({ onCallStatus: "on_job", updatedAt: input.now })
      .where(
        inArray(
          cleaners.id,
          working.map((c) => c.cleanerId),
        ),
      );
    return { started: !packet?.gpsCheckInTimestamp };
  });
}

export async function recordJobDeparture(input: VisitInput) {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select({ status: jobs.status })
      .from(jobs)
      .where(eq(jobs.id, input.jobId))
      .for("update");
    if (!job) throw new JobVisitError("Job not found", 404);
    if (input.cleanerId) {
      const working = await tx.query.jobsToCleaners.findFirst({
        where: and(
          eq(jobsToCleaners.jobId, input.jobId),
          eq(jobsToCleaners.cleanerId, input.cleanerId),
          inArray(jobsToCleaners.role, ["primary", "laundry_lead"]),
        ),
      });
      if (!working)
        throw new JobVisitError(
          "Only the working team may record departure",
          403,
        );
    }
    const packet = await tx.query.evidencePackets.findFirst({
      where: eq(evidencePackets.jobId, input.jobId),
    });
    if (
      ["completed_pending_evidence", "awaiting_capture", "completed"].includes(
        job.status ?? "",
      ) &&
      packet?.gpsCheckOutTimestamp
    )
      return { departed: false };
    if (
      job.status !== "in-progress" ||
      !packet?.gpsCheckInTimestamp ||
      packet.finalEvidenceSubmittedAt
    )
      throw new JobVisitError("Check in before recording departure", 409);
    await tx
      .update(jobs)
      .set({ status: "completed_pending_evidence", updatedAt: input.now })
      .where(eq(jobs.id, input.jobId));
    await tx
      .update(evidencePackets)
      .set({
        ...input.gpsFields,
        gpsCheckOutTimestamp: input.now,
        updatedAt: input.now,
      })
      .where(eq(evidencePackets.jobId, input.jobId));
    // The proximity pool excludes on_job. Release departed workers unless
    // another working visit still has them physically on site.
    const working = await tx
      .select({ cleanerId: jobsToCleaners.cleanerId })
      .from(jobsToCleaners)
      .where(
        and(
          eq(jobsToCleaners.jobId, input.jobId),
          inArray(jobsToCleaners.role, ["primary", "laundry_lead"]),
        ),
      );
    if (working.length)
      await tx
        .update(cleaners)
        .set({ onCallStatus: "available", updatedAt: input.now })
        .where(
          and(
            inArray(
              cleaners.id,
              working.map((c) => c.cleanerId),
            ),
            eq(cleaners.onCallStatus, "on_job"),
            sql`not exists (select 1 from ${jobsToCleaners} jc join ${jobs} j on j.id=jc.job_id where jc.cleaner_id=${cleaners.id} and jc.role in ('primary','laundry_lead') and j.status='in-progress')`,
          ),
        );
    return { departed: true };
  });
}
