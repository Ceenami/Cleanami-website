/** Date-only terms must not shift a day in a user's browser timezone. */
export function formatSubscriptionDate(date: string | null | undefined) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Not recorded";
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== date) return "Not recorded";
  return parsed.toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
}
export function subscriptionStatusLabel(status: string | null) {
  if (status === "expired") return "Ended";
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : "Not recorded";
}
