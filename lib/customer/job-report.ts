import type { JobDetails } from "@/lib/queries/jobs";
import { isChecklistSnapshot } from "@/lib/cleaner/checklist-snapshot";
import { getJobDisplay } from "@/lib/constants/service-type";
import { getArrivalWindow } from "@/lib/scheduling/arrival-windows";
import type { ChecklistLogPayload } from "@/lib/cleaner/evidence";
import { residentialCustomerScope } from "./residential-scope";

const iso = (value: Date | string | null | undefined) =>
  value ? new Date(value).toISOString() : null;

/** Explicit customer boundary. Never spread database rows into this response. */
export function toCustomerJobReport(job: JobDetails) {
  const packet = job.evidencePacket;
  const snapshot = isChecklistSnapshot(job.checklistSnapshot)
    ? job.checklistSnapshot
    : null;
  const log = packet?.checklistLog as ChecklistLogPayload | null;
  const completed = new Set(
    (log?.items ?? [])
      .filter((item) => item.completed === true)
      .map((item) => item.id),
  );
  // Legacy evidence has no issued snapshot: keep its recorded task text, without
  // deriving a new checklist from today's mutable property configuration.
  const tasks = snapshot?.items ?? log?.items ?? [];
  const window = getArrivalWindow(job.addonsSnapshot?.arrivalWindow ?? "");
  return {
    id: job.id,
    serviceLabel: getJobDisplay(job).label,
    purchasedScope: residentialCustomerScope(job.addonsSnapshot),
    status: job.status,
    plannedArrival: iso(job.checkInTime),
    arrivalWindowLabel: window?.label ?? null,
    address: job.property?.address ?? null,
    departureAt: iso(packet?.gpsCheckOutTimestamp),
    evidenceSubmittedAt: iso(packet?.finalEvidenceSubmittedAt),
    checklist: tasks.map((item) => ({
      id: item.id,
      task: item.task,
      completed: completed.has(item.id),
    })),
    roomGroups: (packet?.roomGroups ?? []).map((group) => ({
      roomKey: group.roomKey,
      label: group.label,
      minPhotos: group.minPhotos,
      photos: group.photos.filter(Boolean),
      unavailablePhotos: group.photos.filter((photo) => !photo).length,
    })),
    // Only explicitly published anonymous notes are loaded by the owning service.
    publishedNotes: [] as string[],
    canApplyPromo:
      job.addonsSnapshot?.residentialPricing?.ruleVersion !==
        "residential-v2" &&
      job.paymentIntentId === null &&
      job.paymentStatus === null,
    appliedPromoCode: job.promoCode?.code ?? null,
  };
}

export type CustomerJobReport = ReturnType<typeof toCustomerJobReport>;
