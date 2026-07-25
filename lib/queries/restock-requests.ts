import "server-only";

import { db } from "@/db";
import {
  cleaners,
  jobs,
  properties,
  restockRequests,
  RESTOCK_STATUSES,
  type RestockStatus,
  type RestockUrgency,
} from "@/db/schemas";
import { desc, eq } from "drizzle-orm";
import { notifyAdminsOfRestockRequest } from "@/lib/queries/cleaner-notifications";

/** Statuses that still need someone to do something. */
export const OPEN_RESTOCK_STATUSES: RestockStatus[] = [
  "requested",
  "approved",
  "ordered",
];

export type RestockRequestRow = {
  id: string;
  jobId: string | null;
  propertyId: string;
  propertyAddress: string | null;
  cleanerId: string | null;
  cleanerName: string | null;
  item: string;
  quantity: number;
  urgency: RestockUrgency;
  notes: string | null;
  status: RestockStatus;
  adminNotes: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
};

/**
 * Raise a supply request from a job (task 1.16).
 *
 * The property is resolved from the job server-side rather than accepted from
 * the caller: the cleaner is authorised against the *job*, so letting them name
 * the property would let an assigned cleaner file against any property.
 */
export async function createRestockRequestForJob(input: {
  cleanerId: string;
  jobId: string;
  item: string;
  quantity: number;
  urgency: RestockUrgency;
  notes?: string | null;
}): Promise<
  { success: true; id: string } | { success: false; error: string }
> {
  const job = await db.query.jobs.findFirst({
    where: eq(jobs.id, input.jobId),
    columns: { id: true, propertyId: true },
  });

  if (!job?.propertyId) {
    return { success: false, error: "This job has no property on file." };
  }

  const [created] = await db
    .insert(restockRequests)
    .values({
      jobId: job.id,
      propertyId: job.propertyId,
      cleanerId: input.cleanerId,
      item: input.item.trim(),
      quantity: input.quantity,
      urgency: input.urgency,
      notes: input.notes?.trim() || null,
    })
    .returning({ id: restockRequests.id });

  // Best-effort alert; a notification failure must not lose the request.
  try {
    const [cleaner, property] = await Promise.all([
      db.query.cleaners.findFirst({
        where: eq(cleaners.id, input.cleanerId),
        columns: { fullName: true },
      }),
      db.query.properties.findFirst({
        where: eq(properties.id, job.propertyId),
        columns: { address: true },
      }),
    ]);

    await notifyAdminsOfRestockRequest({
      cleanerName: cleaner?.fullName ?? "A cleaner",
      propertyAddress: property?.address ?? "a property",
      item: input.item.trim(),
      quantity: input.quantity,
      urgency: input.urgency,
      jobId: job.id,
    });
  } catch (error) {
    console.error("[restock] admin notification failed", error);
  }

  return { success: true, id: created.id };
}

function toRow(record: {
  restock: typeof restockRequests.$inferSelect;
  propertyAddress: string | null;
  cleanerName: string | null;
}): RestockRequestRow {
  return {
    id: record.restock.id,
    jobId: record.restock.jobId,
    propertyId: record.restock.propertyId,
    propertyAddress: record.propertyAddress,
    cleanerId: record.restock.cleanerId,
    cleanerName: record.cleanerName,
    item: record.restock.item,
    quantity: record.restock.quantity,
    urgency: record.restock.urgency,
    notes: record.restock.notes,
    status: record.restock.status,
    adminNotes: record.restock.adminNotes,
    resolvedAt: record.restock.resolvedAt,
    createdAt: record.restock.createdAt,
  };
}

/** Admin queue, newest first. */
export async function listRestockRequests(): Promise<RestockRequestRow[]> {
  const rows = await db
    .select({
      restock: restockRequests,
      propertyAddress: properties.address,
      cleanerName: cleaners.fullName,
    })
    .from(restockRequests)
    .leftJoin(properties, eq(restockRequests.propertyId, properties.id))
    .leftJoin(cleaners, eq(restockRequests.cleanerId, cleaners.id))
    .orderBy(desc(restockRequests.createdAt));

  return rows.map(toRow);
}

/** A cleaner's own requests, newest first. */
export async function listRestockRequestsForCleaner(
  cleanerId: string
): Promise<RestockRequestRow[]> {
  const rows = await db
    .select({
      restock: restockRequests,
      propertyAddress: properties.address,
      cleanerName: cleaners.fullName,
    })
    .from(restockRequests)
    .leftJoin(properties, eq(restockRequests.propertyId, properties.id))
    .leftJoin(cleaners, eq(restockRequests.cleanerId, cleaners.id))
    .where(eq(restockRequests.cleanerId, cleanerId))
    .orderBy(desc(restockRequests.createdAt));

  return rows.map(toRow);
}

export function isRestockStatus(value: string): value is RestockStatus {
  return (RESTOCK_STATUSES as readonly string[]).includes(value);
}

/** Admin moves a request along the queue. */
export async function updateRestockRequestStatus(input: {
  id: string;
  status: RestockStatus;
  adminNotes?: string | null;
  resolvedByUserId?: string | null;
}): Promise<{ success: boolean; error?: string }> {
  const existing = await db.query.restockRequests.findFirst({
    where: eq(restockRequests.id, input.id),
    columns: { id: true },
  });

  if (!existing) return { success: false, error: "Request not found." };

  const isTerminal =
    input.status === "fulfilled" || input.status === "declined";

  await db
    .update(restockRequests)
    .set({
      status: input.status,
      adminNotes:
        input.adminNotes === undefined ? undefined : input.adminNotes?.trim() || null,
      resolvedByUserId: isTerminal ? input.resolvedByUserId ?? null : null,
      resolvedAt: isTerminal ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(restockRequests.id, input.id));

  return { success: true };
}
