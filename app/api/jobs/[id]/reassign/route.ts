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
import { findScheduleConflict } from "@/lib/services/assignment/schedule-conflict";
import { appendJobNote } from "@/lib/jobs/job-notes";
import { SERVICE_TYPE_LABELS, type ServiceType } from "@/lib/constants/service-type";
import { getSessionIdentity } from "@/lib/auth/server-roles";
import { notifyCleaner } from "@/lib/services/notifications/notify";
import { PETS_CLEANER_NOTE } from "@/lib/constants/service-type";

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
    const { isAdmin, userRole, error: authError } = await getAdminAuth(request);
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
      override,
      overrideReason,
    } = (await request.json()) as {
      cleanerId?: string;
      role?: string;
      replaceCleanerId?: string;
      /** Super Admin only, and never the default. */
      override?: boolean;
      /** Required whenever `override` is true. */
      overrideReason?: string;
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
      columns: {
        id: true,
        checkInTime: true,
        expectedHours: true,
        notes: true,
        serviceType: true,
      },
      with: {
        property: { columns: { address: true, petsAllowed: true } },
      },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    /**
     * The one-job-per-cleaner-per-day rule, enforced on the manual path.
     *
     * This route performed **no** conflict check at all before M5, so an admin
     * could hand-assign a double-booking that the engine would have refused —
     * the rule existed only where nobody was watching.
     *
     * A Super Admin may still override, because the rule is policy rather than
     * physics: same day with free hours is a scheduling choice, and there are
     * real days when someone has to work two cleans. What the override may not
     * be is quiet — it needs the narrower role, a typed reason, and a record.
     */
    let overrideNote: string | null = null;

    if (job.checkInTime && cleanerId) {
      const conflict = await findScheduleConflict({
        cleanerId,
        checkInTime: job.checkInTime,
        expectedHours: job.expectedHours,
        excludeJobId: id,
        rule: "same_day",
      });

      if (conflict) {
        const conflictLabel =
          SERVICE_TYPE_LABELS[
            (conflict.serviceType as ServiceType | null) ??
              "vacation_rental_subscription"
          ];

        if (!override) {
          // 409 with enough detail for the UI to *explain* the block rather
          // than merely assert it — which is what makes the override a
          // deliberate decision instead of a reflex.
          return NextResponse.json(
            {
              error:
                "That cleaner already has a job on this date. One job per cleaner per day.",
              code: "same_day_conflict",
              conflict: {
                jobId: conflict.jobId,
                date: conflict.easternDate,
                serviceType: conflict.serviceType,
                serviceTypeLabel: conflictLabel,
              },
              overridable: true,
            },
            { status: 409 }
          );
        }

        // `isAdminRole` is true for BOTH admin and super_admin, so the auth
        // check above is not enough here; we want the narrower one.
        if (userRole !== "super_admin") {
          return NextResponse.json(
            {
              error:
                "Only a Super Admin can override the one-job-per-day rule.",
              code: "override_forbidden",
            },
            { status: 403 }
          );
        }

        const reason = overrideReason?.trim() ?? "";
        if (!reason) {
          return NextResponse.json(
            {
              error: "An override requires a reason.",
              code: "override_reason_required",
            },
            { status: 400 }
          );
        }

        // `jobs.notes` is the existing audit surface for this class of event.
        // Structured override auditing (reason codes, an admin id, its own
        // table) is a Phase 2B-shaped item — `cleaner_audit_logs` covers
        // account lifecycle only.
        overrideNote =
          `[Override] Super Admin assigned a cleaner who already works ` +
          `${conflict.easternDate ?? "that date"} (${conflictLabel}, job ` +
          `${conflict.jobId}). Reason: ${reason}. ` +
          `By ${(await getSessionIdentity()).email ?? "super_admin"} at ` +
          `${new Date().toISOString()}.`;
      }
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
        // Appended, never assigned — `jobs.notes` is written by seeding, the
        // crons, capture and reconciliation, none of which know about each
        // other (see `appendJobNote`).
        ...(overrideNote
          ? { notes: appendJobNote(job.notes, overrideNote) }
          : {}),
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

    /**
     * Tell the cleaner. This route notified **nobody** before M6 — a
     * pre-existing gap that did not matter much while the assignment engine
     * placed almost every job, and matters a great deal now: in 2A a
     * residential clean the engine cannot staff is assigned **by hand**, from
     * here, and the cleaner would have found out by opening the app.
     *
     * Working roles only. A shadow backup is not "assigned a clean" and telling
     * them so would have them turn up.
     *
     * Best-effort and last: the assignment is committed by this point, and a
     * push provider being down must not fail it.
     */
    if (WORKING_ROLES.includes(role as (typeof WORKING_ROLES)[number])) {
      try {
        const address = job.property?.address ?? "your assigned property";
        const when = job.checkInTime
          ? job.checkInTime.toLocaleString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
              timeZone: "America/New_York",
            })
          : "soon";
        const kind =
          job.serviceType === "residential_one_time"
            ? SERVICE_TYPE_LABELS.residential_one_time
            : SERVICE_TYPE_LABELS.vacation_rental_subscription;
        const petLine = job.property?.petsAllowed
          ? ` ${PETS_CLEANER_NOTE}`
          : "";

        await notifyCleaner({
          cleanerId,
          type: "assignment",
          title: urgentBonus ? "Urgent job assigned" : "New job assigned",
          message: `You've been assigned a ${kind} at ${address} on ${when}.${petLine}`,
          jobId: id,
          url: `/cleaner/jobs/${id}`,
          // Hand assignment inside the urgent window is last-minute cover, and
          // that is exactly what `notifyCleaner`'s SMS channel is reserved for.
          sms: urgentBonus,
        });
      } catch (err) {
        console.error("[reassign] cleaner notification failed:", err);
      }
    }

    return NextResponse.json({
      success: true,
      role,
      urgentBonus,
      overrideApplied: overrideNote !== null,
    });
  } catch (error) {
    console.error("Error reassigning cleaner:", error);
    return NextResponse.json(
      { error: "Failed to reassign cleaner" },
      { status: 500 }
    );
  }
}
