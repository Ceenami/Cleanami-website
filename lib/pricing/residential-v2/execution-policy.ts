/** Prospective residential execution terms; workbook rate/config identity stays separate. */
export const V2_EXECUTION_POLICY = "residential-v2-execution-2026-11-02" as const;
export type V2ExecutionPolicy = typeof V2_EXECUTION_POLICY;
export type V2Settlement = "completed" | "late_cancellation" | "removed";

/** Money is integer cents. The minimum is base compensation before penalties. */
export function executionPayComponents(input: {
  basePayCents: number;
  leadPayCents: number;
  urgentBonusEligible: boolean;
  arrivalDelayMinutes: number;
  settlement: V2Settlement;
}) {
  const removed = input.settlement === "removed" ||
    (input.settlement === "completed" && input.arrivalDelayMinutes >= 60);
  const settlement: V2Settlement = removed ? "removed" : input.settlement;
  const lateDeductionCents = removed ? input.basePayCents :
    settlement === "completed" && input.arrivalDelayMinutes >= 30
      ? Math.min(input.basePayCents, Math.floor(input.arrivalDelayMinutes / 10) * 500)
      : 0;
  const leadPayCents = settlement === "completed" ? input.leadPayCents : 0;
  const urgentBonusCents = !removed && input.urgentBonusEligible ? 1000 : 0;
  return {
    settlement, lateDeductionCents, leadPayCents, urgentBonusCents,
    totalCents: input.basePayCents - lateDeductionCents + leadPayCents + urgentBonusCents,
  };
}
