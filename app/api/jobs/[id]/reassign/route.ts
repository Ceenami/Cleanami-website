import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { jobs, jobsToCleaners, swapRequests } from "@/db/schemas";
import { recalculateJobRoles } from "@/lib/services/assignment/team-roles";
import {
  hasOpenUrgentSwap,
  dismissSwapAvailableNotifications,
} from "@/lib/services/urgent-replacement.service";
import { eq, and, inArray } from "drizzle-orm";
import { getAdminAuth } from "@/lib/admin-auth";

/** Roles an admin may hand out by hand. */
const ASSIGNABLE_ROLES = ["primary", "backup", "laundry_lead"] as const;
type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

/** Roles that actually work the job, as opposed to shadowing it. */
const WORKING_ROLES = ["primary", "laundry_lead"] as const;

const URGENT_BONUS_WINDOW_MS = 24 * 60 * 60 * 1000;

function isAssignableRole(value: unknown): value is AssignableRole {
  return ASSIGNABLE_ROLES.includes(value as AssignableRole);
}

/**
 * Manual assignment override: puts a cleaner into a role on a job.
 *
 * Scoped to the role being filled. Assigning a backup leaves the working team
 * untouched, which is what makes it possible to set a main and a backup cleaner
 * on the same job — previously every call cleared the primaries regardless of
 * the role asked for, so naming a backup silently unstaffed the clean.
 *
 * Pass `replaceCleanerId` to swap one specific cleaner out; omit it to replace
 * whoever currently holds the role.
 */
export async function POST(
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
    const {
      cleanerId,
      role = "primary",
      replaceCleanerId,
    } = (await request.json()) as {
      cleanerId?: string;
      role?: string;
      replaceCleanerId?: string;
    };

    if (!cleanerId) {
      return NextResponse.json(
        { error: "Cleaner ID is required" },
        { status: 400 }
      );
    }

    if (!isAssignableRole(role)) {
      return NextResponse.json(
        { error: `Role must be one of: ${ASSIGNABLE_ROLES.join(", ")}` },
        { status: 400 }
      );
    }

    const job = await db.query.jobs.findFirst({
      where: eq(jobs.id, id),
      columns: { id: true, checkInTime: true },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const isUrgent = await hasOpenUrgentSwap(id);
    // The $10 bonus is for genuinely last-minute cover, so it only rides along
    // when the job is inside the urgent window at the moment of assignment.
    const withinUrgentWindow = job.checkInTime
      ? job.checkInTime.getTime() - Date.now() <= URGENT_BONUS_WINDOW_MS
      : false;
    const urgentBonus = isUrgent && withinUrgentWindow;
    const now = new Date();

    if (replaceCleanerId) {
      await db
        .delete(jobsToCleaners)
        .where(
          and(
            eq(jobsToCleaners.jobId, id),
            eq(jobsToCleaners.cleanerId, replaceCleanerId)
          )
        );
    } else {
      await db
        .delete(jobsToCleaners)
        .where(and(eq(jobsToCleaners.jobId, id), eq(jobsToCleaners.role, role)));
    }

    // The cleaner may already be on the job in another role, and (job, cleaner)
    // is the primary key — move them rather than failing the insert.
    await db
      .insert(jobsToCleaners)
      .values({ jobId: id, cleanerId, role, urgentBonus })
      .onConflictDoUpdate({
        target: [jobsToCleaners.jobId, jobsToCleaners.cleanerId],
        set: { role, urgentBonus, updatedAt: now },
      });

    const working = await db.query.jobsToCleaners.findMany({
      where: and(
        eq(jobsToCleaners.jobId, id),
        inArray(jobsToCleaners.role, [...WORKING_ROLES])
      ),
      columns: { cleanerId: true },
    });

    await db
      .update(jobs)
      .set({
        status: working.length > 0 ? "assigned" : "unassigned",
        updatedAt: now,
      })
      .where(eq(jobs.id, id));

    await recalculateJobRoles(id);

    // Filling the working seat settles any open replacement offer on this job.
    if (isUrgent && working.length > 0) {
      await db
        .update(swapRequests)
        .set({
          status: "accepted",
          replacementCleanerId: cleanerId,
          updatedAt: now,
        })
        .where(
          and(eq(swapRequests.jobId, id), eq(swapRequests.status, "urgent"))
        );

      await dismissSwapAvailableNotifications(id);
    }

    return NextResponse.json({ success: true, role, urgentBonus });
  } catch (error) {
    console.error("Error reassigning cleaner:", error);
    return NextResponse.json(
      { error: "Failed to reassign cleaner" },
      { status: 500 }
    );
  }
}
