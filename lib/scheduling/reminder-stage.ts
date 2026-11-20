import { formatInTimeZone } from "date-fns-tz";
import { availabilityGraceEnabled } from "@/lib/cleaner/availability-deadline";
export function availabilityReminderStage(
  now = new Date(),
): "friday" | "morning" | "last_call" | "missed" | null {
  const weekday = formatInTimeZone(now, "America/New_York", "i");
  const hour = Number(formatInTimeZone(now, "America/New_York", "H"));
  if (weekday === "5") return hour >= 18 ? "friday" : null;
  if (weekday !== "7") return null;
  if (availabilityGraceEnabled() && hour === 18) return null;
  return hour >= 18
    ? "missed"
    : hour >= 17
      ? "last_call"
      : hour >= 12
        ? "morning"
        : null;
}
