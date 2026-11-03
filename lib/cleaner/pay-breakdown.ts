import type { CleanerJobRole } from "@/lib/queries/cleaner-jobs";

export type PayBreakdownData = {
  pricingVersion?: "residential-v2";
  executionPolicy?: string;
  minimumTopUp?: number;
  leadHours?: number;
  leadPay?: number;
  historicalEstimate?: boolean;
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
import { payReceiptSchema } from "@/lib/pricing/residential-v2/contracts";

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
  residentialPricing?: unknown;
  assignmentTerms?: unknown;
}): PayBreakdownData {
  const baseHours =
    input.role === "backup" ? 0 : parseFloat(input.expectedHours || "0");

  const pay = computeCleanerPay({
    residentialPricing: input.residentialPricing,
    assignmentTerms: input.assignmentTerms,
    expectedHours: input.role === "backup" ? 0 : baseHours,
    hourlyRateCents: input.hourlyRateCents,
    role: input.role,
    laundryLoads: input.laundryLoads,
    urgentBonus: input.role === "backup" ? false : input.urgentBonus,
    arrivalDelayMinutes: input.arrivalDelayMinutes,
  });

  const urgentBonusEligible =
    input.role !== "backup" && (input.urgentBonus ?? false);
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
    ...(pay.receipt
      ? {
          pricingVersion: "residential-v2" as const,
          executionPolicy: pay.receipt.executionPolicy,
          minimumTopUp: pay.minimumTopUp,
          leadHours: pay.receipt.leadHours,
          leadPay: pay.leadPay,
        }
      : {}),
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
  pricingVersion?: string;
  payReceipt?: unknown;
  amount: number;
  urgentBonusAmount: number;
  laundryBonusAmount: number;
  latePenalty?: number;
  latePenaltyReason?: string | null;
}): PayBreakdownData {
  if (
    input.pricingVersion &&
    !["residential-v1", "residential-v2"].includes(input.pricingVersion)
  )
    throw new Error("Unsupported payout pricing version");
  if (input.pricingVersion === "residential-v2" && !input.payReceipt)
    throw new Error("Residential v2 payout receipt is missing");
  if (input.payReceipt !== undefined && input.payReceipt !== null) {
    const r = payReceiptSchema.parse(input.payReceipt);
    if (
      input.pricingVersion === "residential-v1" ||
      input.amount !== r.totalCents / 100 ||
      input.urgentBonusAmount !== r.urgentBonusCents / 100 ||
      input.laundryBonusAmount !== 0 ||
      (input.latePenalty ?? 0) !== r.lateDeductionCents / 100
    )
      throw new Error("Payout amount differs from immutable receipt");
    return {
      pricingVersion: "residential-v2",
      executionPolicy: r.executionPolicy,
      baseHours: r.baseHours,
      baseRate: r.hourlyRateCents / 100,
      basePay: r.basePayCents / 100,
      minimumTopUp: r.minimumTopUpCents / 100,
      leadHours: r.leadHours,
      leadPay: r.leadPayCents / 100,
      urgentBonus: r.urgentBonusCents / 100,
      laundryLoads: 0,
      laundryBonus: 0,
      latePenalty: r.lateDeductionCents / 100,
      latePenaltyReason: input.latePenaltyReason ?? null,
      total: r.totalCents / 100,
      role: "primary",
      urgentBonusEligible: r.urgentBonusCents > 0,
    };
  }
  const urgentBonus = input.urgentBonusAmount;
  const laundryBonus = input.laundryBonusAmount;
  const latePenalty = input.latePenalty ?? 0;
  const basePay =
    Math.round(
      (input.amount - urgentBonus - laundryBonus + latePenalty) * 100,
    ) / 100;
  const baseHours = Math.round((basePay / BASE_RATE) * 100) / 100;
  const laundryLoads = laundryBonus > 0 ? Math.round(laundryBonus / 5) : 0;

  return {
    historicalEstimate: true,
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
