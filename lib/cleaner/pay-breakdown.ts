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

const BASE_RATE = CLEANER_HOURLY_RATE;

export function buildPayBreakdown(input: {
  expectedHours: string | null;
  role: string;
  urgentBonus: boolean | null;
  laundryLoads?: number | null;
  latePenalty?: number;
  latePenaltyReason?: string | null;
}): PayBreakdownData {
  const baseHours = parseFloat(input.expectedHours || "0");
  const basePay = Math.round(baseHours * BASE_RATE * 100) / 100;
  const urgentBonusEligible = input.urgentBonus ?? false;
  const urgentBonus = urgentBonusEligible ? 10 : 0;

  const laundryLoads =
    input.role === "laundry_lead" ? (input.laundryLoads ?? 0) : 0;
  const laundryBonus = laundryLoads * 5;

  const latePenalty = input.latePenalty ?? 0;
  const latePenaltyReason = input.latePenaltyReason ?? null;

  const total =
    Math.round(
      (basePay + urgentBonus + laundryBonus - latePenalty) * 100
    ) / 100;

  let role: CleanerJobRole = "primary";
  if (input.role === "laundry_lead") role = "laundryLead";
  else if (input.role === "primary") role = "teamLeader";
  else if (input.role === "backup") role = "backup";

  return {
    baseHours,
    baseRate: BASE_RATE,
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
