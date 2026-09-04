import "server-only";

import { db } from "@/db";
import { cleaners, disputes, jobs, notifications, properties } from "@/db/schemas";
import { desc, eq } from "drizzle-orm";

export type DisputeStatus = "pending" | "resolved" | "denied";
export type DisputeType = "pay" | "reliability_score" | "job_assignment";

/**
 * The job a dispute points at, when the cleaner attached one. Null is the
 * common case and is not a defect: a reliability-score dispute rarely has a
 * single job, which is why the client's own wording is "related job if
 * included".
 */
export type AdminDisputeJob = {
  id: string;
  /** First segment of the uuid — what an admin reads out loud. */
  shortId: string;
  scheduledAt: string | null;
  propertyAddress: string | null;
};

export type AdminDispute = {
  id: string;
  cleanerId: string;
  cleanerName: string | null;
  type: DisputeType;
  description: string;
  status: DisputeStatus;
  createdAt: string;
  updatedAt: string;
  job: AdminDisputeJob | null;
};

/** Admin list of real cleaner-filed disputes (newest first). */
export async function listDisputes(): Promise<AdminDispute[]> {
  // One statement with three left joins, not three queries and never
  // Promise.all: parallel queries on this pool are how the pipelining hang was
  // reproduced.
  const rows = await db
    .select({
      id: disputes.id,
      cleanerId: disputes.cleanerId,
      cleanerName: cleaners.fullName,
      type: disputes.type,
      description: disputes.description,
      status: disputes.status,
      createdAt: disputes.createdAt,
      updatedAt: disputes.updatedAt,
      jobId: disputes.jobId,
      jobCheckInTime: jobs.checkInTime,
      jobPropertyAddress: properties.address,
    })
    .from(disputes)
    .leftJoin(cleaners, eq(disputes.cleanerId, cleaners.id))
    .leftJoin(jobs, eq(disputes.jobId, jobs.id))
    .leftJoin(properties, eq(jobs.propertyId, properties.id))
    .orderBy(desc(disputes.createdAt));

  return rows.map((r) => ({
    id: r.id,
    cleanerId: r.cleanerId,
    cleanerName: r.cleanerName,
    type: r.type as DisputeType,
    description: r.description,
    status: r.status as DisputeStatus,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    // The join can only miss if the job was deleted, which sets job_id null
    // anyway — so a non-null id with no row is not a state this can reach.
    job: r.jobId
      ? {
          id: r.jobId,
          shortId: r.jobId.split("-")[0],
          scheduledAt: r.jobCheckInTime ? r.jobCheckInTime.toISOString() : null,
          propertyAddress: r.jobPropertyAddress,
        }
      : null,
  }));
}

/**
 * Resolve or deny a dispute and notify the cleaner in-app. Returns the updated
 * status. Throws if the dispute is missing.
 */
export async function updateDisputeStatus(
  disputeId: string,
  status: "resolved" | "denied",
  adminNote?: string
): Promise<{ disputeId: string; status: DisputeStatus }> {
  const dispute = await db.query.disputes.findFirst({
    where: eq(disputes.id, disputeId),
    columns: { id: true, cleanerId: true, type: true },
  });
  if (!dispute) {
    throw new Error("Dispute not found");
  }

  await db
    .update(disputes)
    .set({ status, updatedAt: new Date() })
    .where(eq(disputes.id, disputeId));

  // Notify the cleaner (in-app) of the outcome.
  const cleaner = await db.query.cleaners.findFirst({
    where: eq(cleaners.id, dispute.cleanerId),
    columns: { userId: true },
  });
  if (cleaner?.userId) {
    const readableType = dispute.type.replace(/_/g, " ");
    await db.insert(notifications).values({
      userId: cleaner.userId,
      type: "dispute_update",
      title: status === "resolved" ? "Dispute resolved" : "Dispute denied",
      message:
        (status === "resolved"
          ? `Your ${readableType} dispute has been resolved.`
          : `Your ${readableType} dispute was reviewed and denied.`) +
        (adminNote ? ` Note: ${adminNote}` : ""),
      metadata: { source: "admin_dispute_review", disputeId },
    });
  }

  return { disputeId, status };
}
