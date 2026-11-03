import "server-only";

import { db, sequentialQueries } from "@/db";
import {
  cleaners,
  jobs,
  properties,
  restockRequests,
  notifications,
  RESTOCK_STATUSES,
  type RestockStatus,
  type RestockUrgency,
} from "@/db/schemas";
import { and, desc, eq } from "drizzle-orm";
import { RESTOCK_ACTIONS } from "@/lib/restocking/types";
export { OPEN_RESTOCK_STATUSES } from "@/lib/restocking/types";
import { notifyAdminsOfRestockRequest } from "@/lib/queries/cleaner-notifications";
import { sendPushToCleaner } from "@/lib/services/push.service";
import { recordNotificationAttempt } from "@/lib/services/notifications/notification-log";

/** Statuses that still need someone to do something. */

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
  | { success: true; id: string; adminNotificationRecorded: boolean }
  | { success: false; error: string }
> {
  const job = await db.query.jobs.findFirst({
    where: eq(jobs.id, input.jobId),
    columns: { id: true, propertyId: true },
  });

  if (!job?.propertyId) {
    return { success: false, error: "This job has no property on file." };
  }
  // Bound out of `job` so the narrowing above survives into the closures below.
  const propertyId = job.propertyId;

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
  let adminNotificationRecorded = false;
  try {
    // Sequential, not `Promise.all` — see `sequentialQueries` in db/index.ts.
    const [cleaner, property] = await sequentialQueries(
      () =>
        db.query.cleaners.findFirst({
          where: eq(cleaners.id, input.cleanerId),
          columns: { fullName: true },
        }),
      () =>
        db.query.properties.findFirst({
          where: eq(properties.id, propertyId),
          columns: { address: true },
        }),
    );

    const recipients = await notifyAdminsOfRestockRequest({
      cleanerName: cleaner?.fullName ?? "A cleaner",
      propertyAddress: property?.address ?? "a property",
      item: input.item.trim(),
      quantity: input.quantity,
      urgency: input.urgency,
      jobId: job.id,
      propertyId,
      requestId: created.id,
    });
    adminNotificationRecorded = recipients > 0;
  } catch (error) {
    console.error("[restock] admin notification failed", error);
    await recordNotificationAttempt({
      channel: "in_app",
      status: "failed",
      error,
      meta: { trigger: "restock_request", jobId: job.id },
    });
  }

  return { success: true, id: created.id, adminNotificationRecorded };
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
  cleanerId: string,
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

export type RestockStatusResult = {
  success: boolean;
  error?: string;
  conflict?: boolean;
  notificationStatus?: "recorded" | "unavailable" | "not_needed";
};
type RestockPush = {
  cleanerId: string;
  userId: string;
  jobId: string | null;
  title: string;
  message: string;
  url: string;
};

/** The status and recipient's inbox row commit together; external push follows commit. */
export async function updateRestockRequestStatus(input: {
  id: string;
  status: RestockStatus;
  adminNotes?: string | null;
  resolvedByUserId?: string | null;
}): Promise<RestockStatusResult> {
  const outcome = await db.transaction(
    async (
      tx,
    ): Promise<{ result: RestockStatusResult; push: RestockPush | null }> => {
      const existing = await tx.query.restockRequests.findFirst({
        where: eq(restockRequests.id, input.id),
      });
      const done = (result: RestockStatusResult) => ({ result, push: null });
      if (!existing)
        return done({ success: false, error: "Request not found." });
      const statusChanged = existing.status !== input.status;
      if (!statusChanged && input.adminNotes === undefined)
        return done({ success: true, notificationStatus: "not_needed" });
      if (
        statusChanged &&
        !RESTOCK_ACTIONS[existing.status].includes(input.status)
      ) {
        return done({
          success: false,
          conflict: true,
          error:
            "This request has changed. Refresh and choose an available action.",
        });
      }
      const terminal =
        input.status === "fulfilled" || input.status === "declined";
      const changed = await tx
        .update(restockRequests)
        .set({
          status: input.status,
          adminNotes:
            input.adminNotes === undefined
              ? undefined
              : input.adminNotes?.trim() || null,
          resolvedByUserId: terminal
            ? statusChanged
              ? (input.resolvedByUserId ?? null)
              : existing.resolvedByUserId
            : null,
          resolvedAt: terminal
            ? statusChanged
              ? new Date()
              : existing.resolvedAt
            : null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(restockRequests.id, input.id),
            eq(restockRequests.status, existing.status),
          ),
        )
        .returning({ id: restockRequests.id });
      if (!changed.length)
        return done({
          success: false,
          conflict: true,
          error: "This request has changed. Refresh and try again.",
        });
      // Internal office-note edits alone never send private notes to a cleaner.
      if (!statusChanged)
        return done({ success: true, notificationStatus: "not_needed" });
      const cleaner = existing.cleanerId
        ? await tx.query.cleaners.findFirst({
            where: eq(cleaners.id, existing.cleanerId),
            columns: { userId: true },
          })
        : null;
      if (!cleaner?.userId || !existing.cleanerId)
        return done({ success: true, notificationStatus: "unavailable" });
      const property = await tx.query.properties.findFirst({
        where: eq(properties.id, existing.propertyId),
        columns: { address: true },
      });
      const action = input.status === "requested" ? "reopened" : input.status;
      const title = `Restock request ${action}`;
      const message = `Your request for ${existing.quantity} × ${existing.item}${property?.address ? ` at ${property.address}` : ""} was ${action}.`;
      const url = `/cleaner/restocking?requestId=${existing.id}`;
      // urgent_job is the existing operational restock type; source identifies the domain.
      await tx.insert(notifications).values({
        userId: cleaner.userId,
        type: "urgent_job",
        title,
        message,
        jobId: existing.jobId,
        metadata: {
          source: "restock_status",
          requestId: existing.id,
          propertyId: existing.propertyId,
          status: input.status,
          previousStatus: existing.status,
          url,
        },
      });
      return {
        result: { success: true, notificationStatus: "recorded" },
        push: {
          cleanerId: existing.cleanerId,
          userId: cleaner.userId,
          jobId: existing.jobId,
          title,
          message,
          url,
        },
      };
    },
  );
  if (outcome.push) {
    const event = outcome.push;
    await recordNotificationAttempt({
      channel: "in_app",
      status: "sent",
      meta: {
        trigger: "restock_status",
        userId: event.userId,
        jobId: event.jobId,
        recipient: event.userId,
      },
    });
    try {
      // Existing inbox-triggered native delivery and web-push rails, one inbox row.
      await sendPushToCleaner(
        event.cleanerId,
        { title: event.title, body: event.message, url: event.url },
        { trigger: "restock_status", userId: event.userId, jobId: event.jobId },
        { throwOnFailure: true },
      );
    } catch (error) {
      console.error(
        "[restock] web push failed; status and inbox update committed",
        error,
      );
      await recordNotificationAttempt({
        channel: "push",
        status: "failed",
        error,
        meta: {
          trigger: "restock_status",
          userId: event.userId,
          jobId: event.jobId,
          recipient: event.cleanerId,
        },
      });
    }
  } else if (outcome.result.notificationStatus === "unavailable") {
    await recordNotificationAttempt({
      channel: "in_app",
      status: "skipped",
      error: "submitting cleaner has no linked user",
      meta: { trigger: "restock_status" },
    });
  }
  return outcome.result;
}
