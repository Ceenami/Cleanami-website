import "server-only";

import { db } from "@/db";
import { jobs } from "@/db/schemas";
import { buildJobStaffingUpdate } from "@/lib/pricing/apply-job-staffing";
import { and, eq, gte, inArray, isNotNull, ne } from "drizzle-orm";

export type RecalculateScope = "future_open" | "all_non_canceled";

/**
 * Re-apply v12 staffing logic to existing jobs.
 * - future_open: upcoming jobs still in the assignment pipeline (default)
 * - all_non_canceled: every non-canceled job with a property (one-time backfill)
 */
export async function recalculateJobStaffing(options?: {
  propertyId?: string;
  jobIds?: string[];
  scope?: RecalculateScope;
}): Promise<{ updated: number; scope: RecalculateScope }> {
  const scope = options?.scope ?? "all_non_canceled";
  const now = new Date();

  const conditions = [isNotNull(jobs.propertyId), ne(jobs.status, "canceled")];

  if (scope === "future_open") {
    conditions.push(
      inArray(jobs.status, [
        "unassigned",
        "assigned",
        "in-progress",
        "awaiting_capture",
        "completed_pending_evidence",
      ]),
      isNotNull(jobs.checkInTime),
      gte(jobs.checkInTime, now)
    );
  }

  if (options?.propertyId) {
    conditions.push(eq(jobs.propertyId, options.propertyId));
  }

  const rows = await db.query.jobs.findMany({
    where: and(...conditions),
    with: {
      property: true,
      subscription: true,
    },
  });

  const targetRows = options?.jobIds?.length
    ? rows.filter((row) => options.jobIds!.includes(row.id))
    : rows;

  let updated = 0;

  for (const row of targetRows) {
    const property = row.property;
    if (!property) continue;

    const checkInTime = row.checkInTime ?? row.createdAt;
    const subscriptionStart =
      row.subscription?.startDate ?? property.createdAt ?? row.createdAt;

    const update = buildJobStaffingUpdate({
      property: {
        bedCount: property.bedCount,
        bathCount: property.bathCount,
        sqFt: property.sqFt,
        laundryType: property.laundryType,
        hotTubServiceLevel: property.hotTubServiceLevel,
        hotTubDrainCadence: property.hotTubDrainCadence,
      },
      checkInTime,
      subscriptionStart: new Date(subscriptionStart),
      existingSnapshot: row.addonsSnapshot as Record<string, unknown> | null,
    });

    await db
      .update(jobs)
      .set({
        expectedHours: update.expectedHours,
        addonsSnapshot: update.addonsSnapshot,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, row.id));

    updated += 1;
  }

  return { updated, scope };
}
