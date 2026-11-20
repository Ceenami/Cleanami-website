/** Exact elapsed instants. Exactly 24 hours is fee-free; past/start time is
 * not a self-service cancellation. No flooring to whole hours. */
import { thirtyDayMinimumEndDate } from "./minimum";
export function isLateFinancialCancellation(start: Date, now: Date) {
  const lead = +start - +now;
  if (!Number.isFinite(lead) || lead <= 0) throw Error("Started/past jobs require reviewed cancellation");
  return lead < 24 * 3_600_000;
}
/** Same calendar-month term calculation as rental signup, with its prospective
 * 30-service-day floor. Duration and discount cannot disagree. */
export function rentalReactivationEndDate(startDate: string, months: number) {
  const start = new Date(`${startDate}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !Number.isFinite(+start) || start.toISOString().slice(0, 10) !== startDate || !Number.isInteger(months) || months < 1 || months > 6) throw Error("Invalid selected term");
  start.setUTCMonth(start.getUTCMonth() + months);
  const selected = start.toISOString().slice(0, 10), minimum = thirtyDayMinimumEndDate(startDate);
  return selected < minimum ? minimum : selected;
}
