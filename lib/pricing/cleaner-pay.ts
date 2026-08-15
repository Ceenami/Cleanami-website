import { CLEANER_HOURLY_RATE } from "@/lib/pricing/staffing-logic";

/** Fallback hourly rate (cents) when a cleaner has no per-cleaner rate set. */
export const DEFAULT_HOURLY_RATE_CENTS = Math.round(CLEANER_HOURLY_RATE * 100);

/** Laundry-lead bonus per load, in dollars (spec §8 / Pricing v3). */
export const LAUNDRY_LEAD_BONUS_PER_LOAD = 5;

/** Urgent (<24h replacement) bonus, in dollars (spec §6). */
export const URGENT_BONUS = 10;

/**
 * Late-arrival pay deduction (dollars) per spec §5/§8/§24:
 *   < 30 min late : no deduction
 *   30–59 min late: −$5 per full 10 minutes late
 *   >= 60 min / no-show: forfeit the base hourly pay (deduction = basePay)
 * Never exceeds basePay (payout can't go negative from lateness).
 */
export function lateArrivalDeduction(
  basePay: number,
  arrivalDelayMinutes: number | null | undefined
): number {
  const delay = arrivalDelayMinutes ?? 0;
  if (delay >= 60) return basePay;
  if (delay >= 30) {
    const raw = Math.floor(delay / 10) * 5;
    return Math.min(basePay, raw);
  }
  return 0;
}

export type CleanerPayInput = {
  expectedHours: number;
  hourlyRateCents: number | null | undefined;
  role: string;
  laundryLoads?: number | null;
  urgentBonus?: boolean | null;
  arrivalDelayMinutes?: number | null;
};

export type CleanerPayResult = {
  /** The rate actually used (dollars/hour) — the cleaner's own, or the fallback. */
  hourlyRate: number;
  basePay: number;
  laundryBonus: number | null;
  urgentBonus: number | null;
  lateDeduction: number | null;
  total: number;
};

/** Compute a single cleaner's payout for a job (dollars). */
export function computeCleanerPay(input: CleanerPayInput): CleanerPayResult {
  const rateCents =
    input.hourlyRateCents && input.hourlyRateCents > 0
      ? input.hourlyRateCents
      : DEFAULT_HOURLY_RATE_CENTS;
  const basePay = input.expectedHours * (rateCents / 100);

  let laundryBonus: number | null = null;
  if (input.role === "laundry_lead" && input.laundryLoads) {
    laundryBonus = input.laundryLoads * LAUNDRY_LEAD_BONUS_PER_LOAD;
  }

  const urgentBonus = input.urgentBonus ? URGENT_BONUS : null;

  const deduction = lateArrivalDeduction(basePay, input.arrivalDelayMinutes);
  const lateDeduction = deduction > 0 ? deduction : null;

  const total =
    basePay - deduction + (laundryBonus ?? 0) + (urgentBonus ?? 0);

  return {
    hourlyRate: rateCents / 100,
    basePay,
    laundryBonus,
    urgentBonus,
    lateDeduction,
    total: Math.max(0, total),
  };
}
