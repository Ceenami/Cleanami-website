import "server-only";
import { db } from "@/db";
import { disputes, jobs, properties } from "@/db/schemas";
import { desc, eq } from "drizzle-orm";

export const CLEANER_DISPUTE_HISTORY_LIMIT = 100;

/** A cleaner's own public support history; never select admin/internal fields. */
export async function getCleanerDisputeHistory(cleanerId: string) {
  const rows = await db
    .select({
      id: disputes.id,
      type: disputes.type,
      description: disputes.description,
      status: disputes.status,
      createdAt: disputes.createdAt,
      updatedAt: disputes.updatedAt,
      jobId: jobs.id,
      scheduledAt: jobs.checkInTime,
      propertyAddress: properties.address,
    })
    .from(disputes)
    .leftJoin(jobs, eq(disputes.jobId, jobs.id))
    .leftJoin(properties, eq(jobs.propertyId, properties.id))
    .where(eq(disputes.cleanerId, cleanerId))
    .orderBy(desc(disputes.createdAt), desc(disputes.id))
    .limit(CLEANER_DISPUTE_HISTORY_LIMIT);
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    description: row.description,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    job: row.jobId
      ? {
          id: row.jobId,
          shortId: row.jobId.slice(0, 8),
          scheduledAt: row.scheduledAt?.toISOString() ?? null,
          propertyAddress: row.propertyAddress,
        }
      : null,
  }));
}
