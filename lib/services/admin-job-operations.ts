import "server-only";
import { db } from "@/db";
import { assignmentRuns, jobs, jobsToCleaners } from "@/db/schemas";
import { and, desc, gte, inArray, lte } from "drizzle-orm";
import { getJobDisplay } from "@/lib/constants/service-type";
import { getPaymentDisplay } from "@/lib/constants/payment-status";
import { isChecklistSnapshot } from "@/lib/cleaner/checklist-snapshot";
import { jobOperationsWarning } from "@/lib/jobs/operations-status";
import { scheduleWarnings } from "@/lib/jobs/schedule-warnings";
import { recordedAssignmentSource } from "@/lib/jobs/assignment-audit";
import type { AdminJobOperations } from "@/lib/jobs/admin-job-summary";

/** Admin callers only. Customer routes continue to serialize their explicit allowlists. */
export async function loadAdminJobOperations(
  jobIds: string[],
): Promise<Map<string, AdminJobOperations>> {
  if (!jobIds.length) return new Map();
  const rows = await db.query.jobs.findMany({
    where: inArray(jobs.id, jobIds),
    columns: {
      id: true,
      status: true,
      serviceType: true,
      jobLabel: true,
      checkInTime: true,
      checkOutTime: true,
      expectedHours: true,
      addonsSnapshot: true,
      checklistSnapshot: true,
      paymentStatus: true,
    },
    with: {
      property: {
        columns: { id: true },
        with: { customer: { columns: { name: true } } },
      },
      cleaners: {
        columns: { cleanerId: true, role: true },
        with: {
          cleaner: {
            columns: {
              fullName: true,
              hasHotTubCert: true,
              hasLaundryLeadCert: true,
            },
          },
        },
      },
      evidencePacket: {
        columns: {
          gpsCheckInTimestamp: true,
          finalEvidenceSubmittedAt: true,
          status: true,
          isChecklistComplete: true,
          photoUrls: true,
        },
      },
    },
  });
  const runs = await db.query.assignmentRuns.findMany({
    where: inArray(assignmentRuns.jobId, jobIds),
    orderBy: [desc(assignmentRuns.createdAt), desc(assignmentRuns.id)],
    columns: {
      jobId: true,
      outcome: true,
      reason: true,
      candidates: true,
      context: true,
    },
  });
  const workingIds = [
    ...new Set(
      rows.flatMap((job) =>
        job.cleaners
          .filter((c) => ["primary", "laundry_lead"].includes(c.role))
          .map((c) => c.cleanerId),
      ),
    ),
  ];
  const times = rows.flatMap((row) =>
    row.checkInTime ? [row.checkInTime.getTime()] : [],
  );
  // Include neighboring assignments outside this result page/month, so pagination
  // cannot hide an overlapping or same-day working job.
  const neighbors =
    workingIds.length && times.length
      ? await db.query.jobs.findMany({
          where: and(
            inArray(
              jobs.id,
              db
                .select({ id: jobsToCleaners.jobId })
                .from(jobsToCleaners)
                .where(inArray(jobsToCleaners.cleanerId, workingIds)),
            ),
            gte(jobs.checkInTime, new Date(Math.min(...times) - 86_400_000)),
            lte(jobs.checkInTime, new Date(Math.max(...times) + 86_400_000)),
          ),
          columns: {
            id: true,
            status: true,
            checkInTime: true,
            checkOutTime: true,
            expectedHours: true,
            serviceType: true,
          },
          with: { cleaners: { columns: { cleanerId: true, role: true } } },
        })
      : [];
  const conflicts = scheduleWarnings(neighbors);
  return new Map(
    rows.map((job) => {
      const packet = job.evidencePacket;
      const workers = job.cleaners.filter((c) =>
        ["primary", "laundry_lead"].includes(c.role),
      );
      const cap = isChecklistSnapshot(job.checklistSnapshot)
        ? job.checklistSnapshot.capabilityRequirements
        : null;
      const warnings = [...(conflicts.get(job.id) ?? [])];
      const arrivalWarning = jobOperationsWarning({
        ...job,
        checkedIn: !!packet?.gpsCheckInTimestamp,
      });
      if (arrivalWarning) warnings.push(arrivalWarning);
      if (
        !["canceled", "completed", "awaiting_capture"].includes(
          job.status ?? "",
        )
      ) {
        if (workers.length < (job.addonsSnapshot?.teamSize ?? 1))
          warnings.push("Working team is incomplete");
        if (
          (cap?.hotTub ||
            (!!job.addonsSnapshot?.hotTubServiceLevel &&
              job.addonsSnapshot.hotTubServiceLevel !== "none")) &&
          !workers.some((c) => c.cleaner.hasHotTubCert)
        )
          warnings.push("Hot-tub capability missing");
        if (
          (cap?.laundryLead ||
            job.addonsSnapshot?.laundryType === "off_site") &&
          !workers.some(
            (c) => c.role === "laundry_lead" && c.cleaner.hasLaundryLeadCert,
          )
        )
          warnings.push("Certified laundry lead missing");
      }
      const history = runs.filter((run) => run.jobId === job.id);
      return [
        job.id,
        {
          customerName: job.property?.customer?.name ?? null,
          serviceLabel: getJobDisplay(job).label,
          paymentLabel:
            getPaymentDisplay(job.status, job.paymentStatus)?.admin ??
            "Not recorded",
          checklistLabel: packet?.isChecklistComplete
            ? "Complete"
            : packet
              ? "Incomplete"
              : "Not submitted",
          evidenceLabel: packet?.finalEvidenceSubmittedAt
            ? "Submitted"
            : packet?.status === "pending_review"
              ? "Pending review"
              : "Pending",
          photoCount: packet?.photoUrls?.length ?? 0,
          cleaners: job.cleaners.map((assignment) => ({
            id: assignment.cleanerId,
            name: assignment.cleaner.fullName,
            role: assignment.role,
            source: recordedAssignmentSource(
              assignment.cleanerId,
              assignment.role,
              history,
            ),
          })),
          warnings: [...new Set(warnings)],
        } satisfies AdminJobOperations,
      ];
    }),
  );
}
