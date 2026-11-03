import { getArrivalWindow } from "@/lib/scheduling/arrival-windows";
export function jobOperationsWarning(
  job: {
    status: string | null;
    checkInTime: Date | string | null;
    serviceType?: string;
    addonsSnapshot?: { arrivalWindow?: string | null } | null;
    checkedIn?: boolean;
  },
  now = new Date(),
): string | null {
  if (job.status === "completed_pending_evidence")
    return "Departed — evidence pending";
  if (job.status === "unassigned") return "Unassigned — review staffing";
  if (job.status !== "assigned" || job.checkedIn || !job.checkInTime)
    return null;
  const start = new Date(job.checkInTime).getTime(),
    window = getArrivalWindow(job.addonsSnapshot?.arrivalWindow ?? "");
  const latest =
    start +
    (job.serviceType === "residential_one_time" && window
      ? (window.endMinutes - window.startMinutes) * 60_000
      : 0);
  return now.getTime() > latest + 15 * 60_000
    ? "Arrival overdue — no check-in recorded"
    : null;
}
