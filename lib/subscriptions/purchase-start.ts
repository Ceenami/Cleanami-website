import { toEasternDateString } from "@/lib/time/eastern";
import { thirtyDayMinimumEndDate } from "./minimum";

export const PURCHASE_DATE_START = "purchase_date_v1";

/** The successful charge supplies the purchase instant, not checkout creation. */
export function purchaseTermDates(paidAtSeconds: number, months: number) {
  if (!Number.isSafeInteger(paidAtSeconds) || paidAtSeconds <= 0 ||
      !Number.isInteger(months) || months < 1 || months > 6)
    throw Error("Verified purchase time and subscription length are required");
  const startDate = toEasternDateString(new Date(paidAtSeconds * 1000));
  const start = new Date(`${startDate}T12:00:00Z`);
  const month = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
  month.setUTCDate(Math.min(start.getUTCDate(), lastDay));
  const minimumEnd = thirtyDayMinimumEndDate(startDate);
  const endDate = month.toISOString().slice(0, 10);
  const firstService = new Date(start);
  firstService.setUTCDate(firstService.getUTCDate() + 7);
  return { startDate, endDate: endDate < minimumEnd ? minimumEnd : endDate,
    serviceNotBefore: firstService.toISOString().slice(0, 10) };
}
