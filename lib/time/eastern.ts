const EASTERN_TZ = "America/New_York";

/** Start of the current calendar day in US Eastern (property / ops timezone). */
export function getStartOfTodayEastern(reference = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(reference);

  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);

  // 05:00 UTC ≈ midnight ET (DST-safe enough for date-boundary checks).
  return new Date(Date.UTC(year, month - 1, day, 5, 0, 0, 0));
}

export function getEasternTimeZone() {
  return EASTERN_TZ;
}
