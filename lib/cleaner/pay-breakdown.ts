import type { CleanerJobRole } from "@/lib/queries/cleaner-jobs";

export type PayBreakdownData = {
  baseHours: number;
  baseRate: number;
  basePay: number;
  urgentBonus: number;
  laundryLoads: number;
  laundryBonus: number;
  latePenalty: number;
  latePenaltyReason: string | null;
  total: number;
  role: CleanerJobRole;
  urgentBonusEligible: boolean;
};

import { CLEANER_HOURLY_RATE } from "@/lib/pricing/staffing-logic";
import { computeCleanerPay } from "@/lib/pricing/cleaner-pay";

const BASE_RATE = CLEANER_HOURLY_RATE;

/**
 * Display breakdown for a job's pay, delegating every figure to
 * `computeCleanerPay` — the same function that writes the `payouts` row.
 *
 * It must stay a delegation. This previously recomputed pay inline and took a
 * `latePenalty` number that callers filled with `reliabilityEvents.penaltyPoints`,
 * so reliability POINTS were subtracted as DOLLARS: a 2h job at 83 min late
 * showed 34 − 25 = $9.00 against an actual payout of $0.00 (>=60 min forfeits
 * base pay per spec §5/§8). Pass the lateness itself, not a penalty figure.
 */
export function buildPayBreakdown(input: {
  expectedHours: string | null;
  role: string;
  urgentBonus: boolean | null;
  laundryLoads?: number | null;
  /** The cleaner's own rate; falls back to the standard rate when unset. */
  hourlyRateCents?: number | null;
  /** Minutes late on arrival — the deduction is derived from this, in dollars. */
  arrivalDelayMinutes?: number | null;
  latePenaltyReason?: string | null;
}): PayBreakdownData {
  const baseHours = parseFloat(input.expectedHours || "0");

  const pay = computeCleanerPay({
    expectedHours: baseHours,
    hourlyRateCents: input.hourlyRateCents,
    role: input.role,
    laundryLoads: input.laundryLoads,
    urgentBonus: input.urgentBonus,
    arrivalDelayMinutes: input.arrivalDelayMinutes,
  });

  const urgentBonusEligible = input.urgentBonus ?? false;
  const urgentBonus = pay.urgentBonus ?? 0;

  const laundryLoads =
    input.role === "laundry_lead" ? (input.laundryLoads ?? 0) : 0;
  const laundryBonus = pay.laundryBonus ?? 0;

  const basePay = pay.basePay;
  const latePenalty = pay.lateDeduction ?? 0;
  const latePenaltyReason = input.latePenaltyReason ?? null;
  const total = pay.total;

  let role: CleanerJobRole = "primary";
  if (input.role === "laundry_lead") role = "laundryLead";
  else if (input.role === "primary") role = "teamLeader";
  else if (input.role === "backup") role = "backup";

  return {
    baseHours,
    baseRate: pay.hourlyRate,
    basePay,
    urgentBonus,
    laundryLoads,
    laundryBonus,
    latePenalty,
    latePenaltyReason,
    total,
    role,
    urgentBonusEligible,
  };
}

/** Build breakdown display data from a stored payout row. */
export function buildPayBreakdownFromPayout(input: {
  amount: number;
  urgentBonusAmount: number;
  laundryBonusAmount: number;
  latePenalty?: number;
  latePenaltyReason?: string | null;
}): PayBreakdownData {
  const urgentBonus = input.urgentBonusAmount;
  const laundryBonus = input.laundryBonusAmount;
  const latePenalty = input.latePenalty ?? 0;
  const basePay = Math.round((input.amount - urgentBonus - laundryBonus + latePenalty) * 100) / 100;
  const baseHours = Math.round((basePay / BASE_RATE) * 100) / 100;
  const laundryLoads = laundryBonus > 0 ? Math.round(laundryBonus / 5) : 0;

  return {
    baseHours,
    baseRate: BASE_RATE,
    basePay,
    urgentBonus,
    laundryLoads,
    laundryBonus,
    latePenalty,
    latePenaltyReason: input.latePenaltyReason ?? null,
    total: input.amount,
    role: laundryLoads > 0 ? "laundryLead" : "primary",
    urgentBonusEligible: urgentBonus > 0,
  };
}
