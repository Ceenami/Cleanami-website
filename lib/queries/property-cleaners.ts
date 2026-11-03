import "server-only";

import { db } from "@/db";
import { cleaners, propertyCleaners, propertyExclusions } from "@/db/schemas";
import type { PropertyCleanerTier } from "@/db/schemas";
import { asc, eq, inArray, and, sql } from "drizzle-orm";

export type RosterEntry = {
  cleanerId: string;
  cleanerName: string | null;
  tier: PropertyCleanerTier;
  sortOrder: number;
};

export type RosterInput = {
  cleanerId: string;
  tier: PropertyCleanerTier;
  sortOrder?: number;
};

export class MainPrimaryConflictError extends Error {
  constructor() {
    super("A property can have only one Main Primary Cleaner.");
    this.name = "MainPrimaryConflictError";
  }
}

export async function getPropertyRoster(
  propertyId: string,
): Promise<RosterEntry[]> {
  const rows = await db
    .select({
      cleanerId: propertyCleaners.cleanerId,
      cleanerName: cleaners.fullName,
      tier: propertyCleaners.tier,
      sortOrder: propertyCleaners.sortOrder,
    })
    .from(propertyCleaners)
    .innerJoin(cleaners, eq(propertyCleaners.cleanerId, cleaners.id))
    .where(eq(propertyCleaners.propertyId, propertyId))
    .orderBy(asc(propertyCleaners.sortOrder));

  return rows.map((r) => ({
    cleanerId: r.cleanerId,
    cleanerName: r.cleanerName,
    tier: r.tier as PropertyCleanerTier,
    sortOrder: r.sortOrder,
  }));
}

/** Replace the whole roster for a property in one transaction. */
export async function setPropertyRoster(
  propertyId: string,
  entries: RosterInput[],
): Promise<{ propertyId: string; count: number }> {
  // De-dupe by cleanerId (unique constraint is per property+cleaner).
  const seen = new Set<string>();
  const deduped = entries.filter((e) => {
    if (seen.has(e.cleanerId)) return false;
    seen.add(e.cleanerId);
    return true;
  });
  if (deduped.filter((entry) => entry.tier === "main_primary").length > 1) {
    throw new MainPrimaryConflictError();
  }

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`property:${propertyId}`},0))`,
    );
    if (
      deduped.length &&
      (
        await tx
          .select()
          .from(propertyExclusions)
          .where(
            and(
              eq(propertyExclusions.propertyId, propertyId),
              inArray(
                propertyExclusions.cleanerId,
                deduped.map((e) => e.cleanerId),
              ),
            ),
          )
      ).length
    )
      throw new Error(
        "A do-not-assign cleaner cannot be added to this roster. Remove the exclusion explicitly first.",
      );
    await tx
      .delete(propertyCleaners)
      .where(eq(propertyCleaners.propertyId, propertyId));

    if (deduped.length > 0) {
      await tx.insert(propertyCleaners).values(
        deduped.map((e, idx) => ({
          propertyId,
          cleanerId: e.cleanerId,
          tier: e.tier,
          sortOrder: e.sortOrder ?? idx,
        })),
      );
    }
  });

  return { propertyId, count: deduped.length };
}
