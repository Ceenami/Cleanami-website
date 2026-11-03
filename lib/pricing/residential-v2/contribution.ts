import { readResidentialSnapshot } from "./contracts";
import { Decimal as D } from "./decimal";
import { computeCleanerPay } from "../cleaner-pay";

export function calculateV2Contribution(job: {
  paymentStatus: string | null;
  addonsSnapshot: unknown;
  cleaners: Array<{
    cleanerId: string;
    role: string;
    residentialPayTerms?: unknown;
    urgentBonus: boolean | null;
  }>;
  payouts: Array<{ cleanerId: string; amount: string }>;
  evidencePacket?: { arrivalDelayMinutes: number | null } | null;
  refundedAmountCents?: number;
}) {
  const frozen = readResidentialSnapshot(job.addonsSnapshot);
  if (frozen.kind !== "v2") throw new Error("V2 financial contract required");
  const { terms, model } = frozen;
  const paid = terms.amountChargedCents;
  const refund =
    job.paymentStatus === "refunded" ? paid : (job.refundedAmountCents ?? 0);
  if (!Number.isSafeInteger(refund) || refund < 0 || refund > paid)
    throw new Error("Invalid refund basis");
  const revenueCents = paid - refund;
  const recorded = new Map(
    job.payouts.map((p) => [p.cleanerId, D.of(Number(p.amount)).cents()]),
  );
  let basis:
    | "recorded_payouts"
    | "frozen_assignment_rates"
    | "incomplete_team"
    | "missing_frozen_rates" = "incomplete_team";
  let laborCents: number | null = null;
  if (recorded.size >= terms.teamSize) {
    laborCents = [...recorded.values()].reduce((a, b) => a + b, 0);
    basis = "recorded_payouts";
  } else {
    const workers = job.cleaners.filter((c) =>
      ["primary", "laundry_lead"].includes(c.role),
    );
    if (workers.length === terms.teamSize) {
      basis = "missing_frozen_rates";
      try {
        laborCents = workers.reduce(
          (sum, c) =>
            sum +
            (recorded.get(c.cleanerId) ??
              Math.round(
                computeCleanerPay({
                  expectedHours: terms.expectedHoursPerCleaner,
                  hourlyRateCents: null,
                  role: c.role,
                  residentialPricing: terms,
                  assignmentTerms: c.residentialPayTerms,
                  urgentBonus: c.urgentBonus,
                  arrivalDelayMinutes: job.evidencePacket?.arrivalDelayMinutes,
                }).total * 100,
              )),
          0,
        );
        basis = "frozen_assignment_rates";
      } catch {
        laborCents = null;
      }
    }
  }
  // Original processing assumption is retained on refunds. This is modeled
  // cost, not observed provider spend. A comp has no card transaction.
  const rules = terms.modeledRules as Record<string, number>;
  const processing =
    paid > 0
      ? D.of(paid / 100)
          .mul(rules.CARD_PERCENT)
          .add(rules.CARD_FIXED)
      : D.of(0);
  const quality = D.of(revenueCents / 100).mul(rules.QUALITY_RESERVE);
  const other = D.of(model.fields.V)
    .add(model.fields.W)
    .add(processing)
    .add(quality);
  const net =
    laborCents === null
      ? null
      : D.of(revenueCents / 100)
          .sub(laborCents / 100)
          .sub(other);
  const margin =
    net === null || revenueCents === 0
      ? null
      : net.div(revenueCents / 100).number();
  const nominalLaborCents = Math.round(model.fields.X * 100);
  return {
    revenueCents,
    quotedRevenueCents: terms.quotedAmountCents,
    laborCents,
    marginCents: laborCents === null ? null : revenueCents - laborCents,
    basis,
    nominalLaborCents,
    nominalMarginCents: revenueCents - nominalLaborCents,
    hoursPerCleaner: terms.expectedHoursPerCleaner,
    teamSize: terms.teamSize,
    contribution: {
      quotedDollars: model.fields.AE,
      quotedPercent: model.fields.AF * 100,
      modeledDollars: net?.number() ?? null,
      modeledPercent: margin === null ? null : margin * 100,
      materialsDollars: model.fields.V,
      operationsPayoutDollars: model.fields.W,
      modeledProcessingDollars: processing.number(),
      qualityAllowanceDollars: quality.number(),
      floorDollars: model.fields.Z,
      floorStatus:
        margin === null
          ? "UNAVAILABLE"
          : margin + 1e-7 >= rules.MARGIN_FLOOR
            ? "PASS"
            : "EXCEPTION",
      exception:
        terms.compedCents > 0 ? "owner_comp" : refund > 0 ? "refund" : null,
      revenueBasis: "paid_less_recorded_refunds",
      processingBasis: "original_charge_model",
      partialRefundCoverage:
        job.refundedAmountCents === undefined
          ? "unrecorded_partial_refunds_excluded"
          : "explicit_refund_amount",
    },
  };
}
