import { addDays } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { format } from "date-fns";
import { PLANNING_PERIOD_DAYS } from "@/lib/cleaner/availability-deadline";

const TZ = "America/New_York";

function parseEtNoon(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return toZonedTime(new Date(year, month - 1, day, 12, 0, 0), TZ);
}

/** End of the cleaner job visibility window (today + 14 days inclusive, ET). */
export function getCleanerJobWindowEnd(reference = new Date()): Date {
  const todayIso = format(toZonedTime(reference, TZ), "yyyy-MM-dd");
  const endDay = addDays(parseEtNoon(todayIso), PLANNING_PERIOD_DAYS - 1);
  endDay.setHours(23, 59, 59, 999);
  return fromZonedTime(endDay, TZ);
}
