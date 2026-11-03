import type { JobsWithDetails } from "@/lib/queries/jobs";
import { getJobDisplay } from "@/lib/constants/service-type";
import { getArrivalWindow } from "@/lib/scheduling/arrival-windows";
export function toCustomerJobListItem(job: JobsWithDetails["data"][number]) {
  return {
    id: job.id,
    status: job.status,
    serviceLabel: getJobDisplay(job).label,
    address: job.property?.address ?? null,
    plannedArrival: job.checkInTime,
    arrivalWindowLabel:
      getArrivalWindow(job.arrivalWindow ?? "")?.label ?? null,
  };
}
export type CustomerJobListItem = ReturnType<typeof toCustomerJobListItem>;
