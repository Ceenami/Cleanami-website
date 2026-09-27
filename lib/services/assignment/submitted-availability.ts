import "server-only";

import { db, sequentialQueries } from "@/db";
import { availability, cleanerAvailabilitySubmissions } from "@/db/schemas";
import {
  buildPeriodFromMonday,
  findOperationalPeriodMonday,
} from "@/lib/cleaner/availability-deadline";
import { toEasternDateString } from "@/lib/time/eastern";
import { and, eq, inArray } from "drizzle-orm";

type CandidateWithCleanerId = { cleanerId: string };

/**
 * Apply a cleaner's explicit availability submission to the assignment pool.
 *
 * Historical rows have no period acknowledgement, so they retain the legacy
 * candidate behavior. Once a cleaner has submitted a full/catch-up block, a
 * date without a positive daily availability row is an explicit "unavailable"
 * and the engine must not auto-assign them to it.
 */
export async function filterCandidatesBySubmittedAvailability<
  T extends CandidateWithCleanerId,
>(candidates: T[], checkInTime: Date): Promise<{
  candidates: T[];
  filteredOut: number;
}> {
  if (candidates.length === 0) return { candidates, filteredOut: 0 };

  const candidateIds = candidates.map((candidate) => candidate.cleanerId);
  const period = buildPeriodFromMonday(findOperationalPeriodMonday(checkInTime));
  const jobDate = toEasternDateString(checkInTime);

  // Sequential, not Promise.all: both are DB reads on the production pooler.
  const [submissions, availableRows] = await sequentialQueries(
    () =>
      db.query.cleanerAvailabilitySubmissions.findMany({
        where: and(
          eq(cleanerAvailabilitySubmissions.periodStart, period.start),
          inArray(cleanerAvailabilitySubmissions.cleanerId, candidateIds)
        ),
        columns: { cleanerId: true },
      }),
    () =>
      db.query.availability.findMany({
        where: and(
          eq(availability.date, jobDate),
          inArray(availability.cleanerId, candidateIds)
        ),
        columns: { cleanerId: true },
      })
  );

  const submittedCleanerIds = new Set(submissions.map((row) => row.cleanerId));
  const availableCleanerIds = new Set(availableRows.map((row) => row.cleanerId));
  const filtered = candidates.filter(
    (candidate) =>
      !submittedCleanerIds.has(candidate.cleanerId) ||
      availableCleanerIds.has(candidate.cleanerId)
  );

  return { candidates: filtered, filteredOut: candidates.length - filtered.length };
}
