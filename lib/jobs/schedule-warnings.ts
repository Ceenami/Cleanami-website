import { toEasternDateString } from "@/lib/time/eastern";
type ScheduledJob = {
  id: string;
  status: string | null;
  checkInTime: Date | string | null;
  checkOutTime?: Date | string | null;
  expectedHours: string | number | null;
  serviceType: string | null;
  cleaners: Array<{ cleanerId: string; role: string }>;
};
/** Operational warnings, not authorization. Includes only physical working roles. */
export function scheduleWarnings(rows: ScheduledJob[]): Map<string, string[]> {
  const result = new Map<string, string[]>(),
    byCleaner = new Map<string, ScheduledJob[]>();
  for (const job of rows) {
    if (!job.checkInTime || job.status === "canceled") continue;
    for (const assignment of job.cleaners) {
      if (!["primary", "laundry_lead"].includes(assignment.role)) continue;
      const entries = byCleaner.get(assignment.cleanerId) ?? [];
      entries.push(job);
      byCleaner.set(assignment.cleanerId, entries);
    }
  }
  function add(id: string, warning: string) {
    const previous = result.get(id) ?? [];
    if (!previous.includes(warning)) previous.push(warning);
    result.set(id, previous);
  }
  function end(job: ScheduledJob) {
    const earliestFinish =
      new Date(job.checkInTime!).getTime() +
      Number(job.expectedHours ?? 4) * 3600000;
    return job.serviceType === "residential_one_time" && job.checkOutTime
      ? Math.max(earliestFinish, new Date(job.checkOutTime).getTime())
      : earliestFinish;
  }
  for (const entries of byCleaner.values()) {
    entries.sort(
      (a, b) =>
        new Date(a.checkInTime!).getTime() - new Date(b.checkInTime!).getTime(),
    );
    for (let a = 0; a < entries.length; a++)
      for (let b = a + 1; b < entries.length; b++) {
        const first = entries[a],
          second = entries[b];
        const sameDay =
          toEasternDateString(new Date(first.checkInTime!)) ===
          toEasternDateString(new Date(second.checkInTime!));
        const overlap = end(first) > new Date(second.checkInTime!).getTime();
        if (!sameDay && !overlap) break;
        const warning = overlap
          ? "Cleaner has overlapping working assignments"
          : "Cleaner works multiple jobs on this Eastern date (review override)";
        add(first.id, warning);
        add(second.id, warning);
      }
  }
  return result;
}
