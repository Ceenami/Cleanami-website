import { formatInTimeZone } from "date-fns-tz";
export function availabilityReminderStage(
  now = new Date(),
): "morning" | "last_call" | "missed" | null {
  if (formatInTimeZone(now, "America/New_York", "i") !== "7") return null;
  const hour = Number(formatInTimeZone(now, "America/New_York", "H"));
  return hour >= 18
    ? "missed"
    : hour >= 17
      ? "last_call"
      : hour >= 9
        ? "morning"
        : null;
}
