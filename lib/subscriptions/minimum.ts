import { addMonths } from "date-fns";
import { fromZonedTime } from "date-fns-tz";

export const THIRTY_DAY_MINIMUM = "thirty_calendar_days_v1" as const;
export const LEGACY_MONTH_MINIMUM = "calendar_month_v1" as const;
export type SubscriptionMinimum = {
  policy: typeof THIRTY_DAY_MINIMUM | typeof LEGACY_MONTH_MINIMUM;
  endsAt: string;
};

/** Subscriptions use date-only service days, with boundaries in US Eastern. */
export function thirtyDayMinimumEndDate(startDate: string): string {
  const day = new Date(`${startDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !Number.isFinite(+day) || day.toISOString().slice(0, 10) !== startDate)
    throw Error("Invalid subscription start date");
  day.setUTCDate(day.getUTCDate() + 30);
  return day.toISOString().slice(0, 10);
}

export function thirtyDayMinimum(startDate: string): SubscriptionMinimum {
  return { policy: THIRTY_DAY_MINIMUM, endsAt: fromZonedTime(`${thirtyDayMinimumEndDate(startDate)}T00:00:00`, "America/New_York").toISOString() };
}

/** Preserve the existing server's calendar-month rule for unversioned contracts. */
export function legacySubscriptionMinimum(startDate: string | Date): SubscriptionMinimum {
  const endsAt = addMonths(new Date(startDate), 1);
  if (!Number.isFinite(+endsAt)) throw Error("Invalid subscription start date");
  return { policy: LEGACY_MONTH_MINIMUM, endsAt: endsAt.toISOString() };
}

export function subscriptionMinimumLabel(minimum: SubscriptionMinimum): string {
  return minimum.policy === THIRTY_DAY_MINIMUM ? "30-day minimum" : "First-month minimum";
}

export function withinSubscriptionMinimum(minimum: SubscriptionMinimum, now = new Date()): boolean {
  if (![THIRTY_DAY_MINIMUM, LEGACY_MONTH_MINIMUM].includes(minimum.policy) || !Number.isFinite(Date.parse(minimum.endsAt)))
    throw Error("Invalid subscription minimum; contact support");
  return +now < Date.parse(minimum.endsAt);
}
