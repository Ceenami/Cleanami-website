/** Days of recent past cleans to show on the dashboard schedule. */
export const DASHBOARD_PAST_DAYS = 7;

import { PLANNING_PERIOD_DAYS } from "@/lib/cleaner/availability-deadline";

/** Max days ahead to show on the dashboard (aligned with cleaner 14-day planning window). */
export const DASHBOARD_FUTURE_DAYS = PLANNING_PERIOD_DAYS;

export function getDashboardJobDateRange(reference = new Date()) {
  const startDate = new Date(reference);
  startDate.setHours(0, 0, 0, 0);
  startDate.setDate(startDate.getDate() - DASHBOARD_PAST_DAYS);

  const endDate = new Date(reference);
  endDate.setHours(23, 59, 59, 999);
  endDate.setDate(endDate.getDate() + DASHBOARD_FUTURE_DAYS);

  return { startDate, endDate };
}

export function dashboardJobsSearchParams(
  extra: Record<string, string> = {}
): string {
  const { startDate, endDate } = getDashboardJobDateRange();
  const params = new URLSearchParams({
    dashboard: "1",
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    ...extra,
  });
  return params.toString();
}
