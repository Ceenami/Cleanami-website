import { computeCleanerPay } from "@/lib/pricing/cleaner-pay";
import { calculateV2Contribution } from "./residential-v2/contribution";

type MarginJob = {
  serviceType: string;
  paymentStatus: string | null;
  expectedHours: string | number | null;
  addonsSnapshot: {
    laundryLoads?: number | null;
    residentialPricing?: {
      ruleVersion?: string;
      amountChargedCents: number;
      quotedAmountCents: number;
      expectedHoursPerCleaner: number;
      teamSize: number;
    };
  } | null;
  cleaners: Array<{
    cleanerId: string;
    role: string;
    frozenHourlyRateCents: number | null;
    urgentBonus: boolean | null;
    residentialPayTerms?: unknown;
  }>;
  payouts: Array<{ cleanerId: string; amount: string }>;
  evidencePacket?: { arrivalDelayMinutes: number | null } | null;
};

/** Labor-only margin. No repricing, current worker rate or new margin floor. */
export function calculateResidentialMargin(job: MarginJob) {
  const terms = job.addonsSnapshot?.residentialPricing;
  if (
    terms?.ruleVersion &&
    !["residential-v1", "residential-v2"].includes(terms.ruleVersion)
  )
    throw new Error("Unsupported residential margin version");
  if (
    job.serviceType === "residential_one_time" &&
    terms?.ruleVersion === "residential-v2"
  )
    return calculateV2Contribution(job);
  if (
    job.serviceType !== "residential_one_time" ||
    !terms ||
    !Number.isSafeInteger(terms.amountChargedCents) ||
    terms.amountChargedCents < 0 ||
    !Number.isSafeInteger(terms.quotedAmountCents) ||
    terms.quotedAmountCents < 0 ||
    !Number.isFinite(terms.expectedHoursPerCleaner) ||
    terms.expectedHoursPerCleaner <= 0 ||
    !Number.isInteger(terms.teamSize) ||
    terms.teamSize < 1 ||
    terms.teamSize > 4
  )
    return null;
  const revenueCents =
    job.paymentStatus === "refunded" ? 0 : terms.amountChargedCents;
  const nominalLaborCents =
    Math.round(terms.expectedHoursPerCleaner * 1700) * terms.teamSize;
  const workers = job.cleaners.filter((assignment) =>
    ["primary", "laundry_lead"].includes(assignment.role),
  );
  const payouts = new Map(
    job.payouts.map((payout) => [
      payout.cleanerId,
      Math.round(Number(payout.amount) * 100),
    ]),
  );
  let laborCents: number | null = null;
  let basis:
    | "recorded_payouts"
    | "frozen_assignment_rates"
    | "incomplete_team"
    | "missing_frozen_rates" = "incomplete_team";
  if (
    payouts.size >= terms.teamSize &&
    [...payouts.values()].every(
      (amount) => Number.isSafeInteger(amount) && amount >= 0,
    )
  ) {
    laborCents = [...payouts.values()].reduce((sum, amount) => sum + amount, 0);
    basis = "recorded_payouts";
  } else if (workers.length === terms.teamSize) {
    basis = "missing_frozen_rates";
    if (
      workers.every(
        (worker) =>
          payouts.has(worker.cleanerId) ||
          (worker.frozenHourlyRateCents ?? 0) > 0,
      )
    ) {
      laborCents = workers.reduce(
        (sum, worker) =>
          sum +
          (payouts.get(worker.cleanerId) ??
            Math.round(
              computeCleanerPay({
                expectedHours: terms.expectedHoursPerCleaner,
                hourlyRateCents: worker.frozenHourlyRateCents,
                role: worker.role,
                laundryLoads: job.addonsSnapshot?.laundryLoads,
                urgentBonus: worker.urgentBonus,
                arrivalDelayMinutes: job.evidencePacket?.arrivalDelayMinutes,
              }).total * 100,
            )),
        0,
      );
      basis = "frozen_assignment_rates";
    }
  }
  return {
    contribution: undefined,
    revenueCents,
    quotedRevenueCents: terms.quotedAmountCents,
    laborCents,
    marginCents: laborCents === null ? null : revenueCents - laborCents,
    basis,
    nominalLaborCents,
    nominalMarginCents: revenueCents - nominalLaborCents,
    hoursPerCleaner: terms.expectedHoursPerCleaner,
    teamSize: terms.teamSize,
  };
}

export type ResidentialMargin = ReturnType<typeof calculateResidentialMargin>;
