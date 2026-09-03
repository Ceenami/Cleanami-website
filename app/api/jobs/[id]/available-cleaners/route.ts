import {
  getAllEligibleCleanersForJob,
  getAvailableCleanersForJob,
} from "@/lib/queries/cleaners-proximity";
import { getAdminAuth } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { jobs } from "@/db/schemas";
import { eq } from "drizzle-orm";
import { findScheduleConflict } from "@/lib/services/assignment/schedule-conflict";

const SERVICE_RADIUS_MILES = 25;

/**
 * Why every candidate is annotated instead of filtered.
 *
 * M5 tightens the conflict rule from *windows overlap* to *same calendar day*.
 * Applied blindly, that removes candidates from this list — and this list is
 * what an admin uses to cover an emergency. A day that already has one clean
 * could then supply no replacement at all, silently
 * (the same rule also makes same-day on-call
 * unusable, which is the busiest day's cover).
 *
 * **Losing cover silently is a worse outcome than the double-booking the rule
 * prevents.** So the rule is applied as *information*, in two grades the admin
 * can act on differently:
 *
 * - `window` conflict — the hours genuinely overlap. No override puts one
 * person in two places at once. Not assignable.
 * - `same_day` only — the cleaner works that day but the hours are free. Policy
 * blocks it; a Super Admin may override with a reason.
 *
 * That distinction is the whole point of keeping both rules on
 * `findScheduleConflict`. Without it the UI can only say "no", which is how an
 * override becomes a reflex rather than a decision.
 */
type CleanerConflictState = "free" | "same_day" | "overlapping";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { isAdmin, error: authError } = await getAdminAuth(request);
    if (!isAdmin) {
      return NextResponse.json(
        { error: authError ?? "Unauthorized" },
        { status: 401 }
      );
    }

    const { id } = await params;

    // Get query params for options
    const searchParams = request.nextUrl.searchParams;
    const includeAll = searchParams.get("all") === "true";
    const radiusMiles = includeAll
      ? null
      : searchParams.get("radius")
        ? parseInt(searchParams.get("radius")!)
        : SERVICE_RADIUS_MILES;
    const includeOnJob = searchParams.get("includeOnJob") !== "false";

    const result = includeAll
      ? await getAllEligibleCleanersForJob(id, { includeOnJob })
      : await getAvailableCleanersForJob(id, {
          radiusMiles,
          includeOnJob,
        });

    const job = await db.query.jobs.findFirst({
      where: eq(jobs.id, id),
      columns: { checkInTime: true, expectedHours: true },
    });

    // One at a time, not `Promise.all` — these are DB queries and the
    // transaction pooler drops all but the first of a pipelined batch.
    const cleaners: Array<
      (typeof result.cleaners)[number] & {
        conflictState: CleanerConflictState;
        conflictJobId: string | null;
        conflictDate: string | null;
      }
    > = [];

    for (const cleaner of result.cleaners) {
      let conflictState: CleanerConflictState = "free";
      let conflictJobId: string | null = null;
      let conflictDate: string | null = null;

      if (job?.checkInTime) {
        // Ask the stricter question first. Only if the day is taken is it worth
        // asking whether the hours actually overlap.
        const sameDay = await findScheduleConflict({
          cleanerId: cleaner.id,
          checkInTime: job.checkInTime,
          expectedHours: job.expectedHours,
          excludeJobId: id,
          rule: "same_day",
        });

        if (sameDay) {
          const overlapping = await findScheduleConflict({
            cleanerId: cleaner.id,
            checkInTime: job.checkInTime,
            expectedHours: job.expectedHours,
            excludeJobId: id,
            rule: "window",
          });
          conflictState = overlapping ? "overlapping" : "same_day";
          conflictJobId = (overlapping ?? sameDay).jobId;
          conflictDate = (overlapping ?? sameDay).easternDate;
        }
      }

      cleaners.push({ ...cleaner, conflictState, conflictJobId, conflictDate });
    }

    return NextResponse.json({
      cleaners,
      radiusMiles: includeAll ? null : radiusMiles,
      includeAll,
      propertyAddress: result.propertyAddress,
    });
  } catch (error) {
    console.error("Error fetching available cleaners:", error);

    if (error instanceof Error && error.message.includes("not found")) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    return NextResponse.json(
      { error: "Failed to fetch available cleaners" },
      { status: 500 }
    );
  }
}

export type GetAvailableCleanersForJobResponse = {
  cleaners: Array<
    Awaited<ReturnType<typeof getAvailableCleanersForJob>>["cleaners"][number] & {
      /**
       * `same_day` is override-able by a Super Admin; `overlapping` is not.
       * See the note at the top of this file for why both are surfaced rather
       * than the candidate being dropped.
       */
      conflictState: CleanerConflictState;
      conflictJobId: string | null;
      conflictDate: string | null;
    }
  >;
  radiusMiles: number | null;
  includeAll?: boolean;
  propertyAddress: string;
};
