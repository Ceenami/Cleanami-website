import "server-only";

import { db } from "@/db";
import { cleaners, disputes, notifications } from "@/db/schemas";
import { desc, eq } from "drizzle-orm";

export type DisputeStatus = "pending" | "resolved" | "denied";
export type DisputeType = "pay" | "reliability_score" | "job_assignment";

export type AdminDispute = {
  id: string;
  cleanerId: string;
  cleanerName: string | null;
  type: DisputeType;
  description: string;
  status: DisputeStatus;
  createdAt: string;
  updatedAt: string;
};

/** Admin list of real cleaner-filed disputes (newest first). */
export async function listDisputes(): Promise<AdminDispute[]> {
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
    })
    .from(disputes)
    .leftJoin(cleaners, eq(disputes.cleanerId, cleaners.id))
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
