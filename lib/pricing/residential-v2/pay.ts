import { Decimal as D } from "./decimal";
import {
  assignmentPayTermsSchema,
  payReceiptSchema,
  type ResidentialPayReceipt,
} from "./contracts";
import { V2_RULES } from "./rules";
import { V2_EXECUTION_POLICY, executionPayComponents, type V2ExecutionPolicy, type V2Settlement } from "./execution-policy";

/** Frozen workbook pay plus the execution policy accepted for this job. */
export function computeResidentialV2Pay(input: {
  assignmentTerms: unknown;
  role: string;
  urgentBonus?: boolean | null;
  arrivalDelayMinutes?: number | null;
  settlement?: V2Settlement;
  executionPolicy?: V2ExecutionPolicy;
}) {
  const t = assignmentPayTermsSchema.parse(input.assignmentTerms);
  const working = ["primary", "laundry_lead"].includes(input.role);
  const settlement = input.settlement ?? "completed";
  const prospective = input.executionPolicy === V2_EXECUTION_POLICY;
  const delay = Math.max(0, input.arrivalDelayMinutes ?? 0);
  if (!Number.isFinite(delay)) throw new Error("Invalid arrival delay");
  if (
    working &&
    !prospective &&
    (input.urgentBonus ||
      (input.arrivalDelayMinutes ?? 0) >= 30 ||
      settlement !== "completed")
  )
    throw new Error(
      "Residential v2 adjustment/cancellation policy requires approval",
    );
  if (
    t.hourlyRateCents !== V2_RULES.CLEANER_PAY_RATE * 100 ||
    t.minimumBaseCents !== V2_RULES.MINIMUM_PAY_PER_CLEANER * 100
  )
    throw new Error("Unsupported residential v2 pay policy");
  if (
    (!t.addonLead && t.leadHours !== 0) ||
    (t.hotTub === "none" && t.inUnitLaundryLoads === 0 && t.leadHours !== 0)
  )
    throw new Error("Invalid residential lead allocation");
  const rawLead = D.of(
    t.hotTub === "basic"
      ? V2_RULES.HOT_BASIC_ACTIVE_HRS
      : t.hotTub === "full"
        ? V2_RULES.HOT_FULL_ACTIVE_HRS
        : 0,
  ).add(D.of(t.inUnitLaundryLoads).mul(V2_RULES.INUNIT_LAUNDRY_HRS));
  if (
    D.of(t.baseHours).up(V2_RULES.PAID_HOUR_INCREMENT).number() !==
      t.baseHours ||
    (t.addonLead &&
      t.leadHours !== rawLead.up(V2_RULES.PAID_HOUR_INCREMENT).number())
  )
    throw new Error("Invalid residential paid-hour allocation");
  const baseHours = working ? t.baseHours : 0;
  const hourlyBaseCents = D.of(baseHours)
    .mul(t.hourlyRateCents / 100)
    .cents();
  const basePayCents = working
    ? Math.max(t.minimumBaseCents, hourlyBaseCents)
    : 0;
  const adjustmentsAllowed = !prospective || (settlement === "completed" && delay < 60);
  const leadHours = working && t.addonLead && adjustmentsAllowed ? t.leadHours : 0;
  const leadPayCents = D.of(leadHours)
    .mul(t.hourlyRateCents / 100)
    .cents();
  const components = executionPayComponents({
    basePayCents, leadPayCents,
    urgentBonusEligible: working && !!input.urgentBonus,
    arrivalDelayMinutes: settlement === "late_cancellation" ? 0 : delay,
    settlement,
  });
  const receipt: ResidentialPayReceipt = payReceiptSchema.parse({
    version: t.version,
    configHash: t.configHash,
    policyRevision: t.policyRevision,
    role: input.role,
    baseHours,
    hourlyRateCents: t.hourlyRateCents,
    minimumBaseCents: working ? t.minimumBaseCents : 0,
    hourlyBaseCents,
    minimumTopUpCents: basePayCents - hourlyBaseCents,
    basePayCents,
    leadHours,
    ...components,
    ...(prospective ? {
      executionPolicy: V2_EXECUTION_POLICY,
      arrivalDelayMinutes: settlement === "late_cancellation" ? 0 : delay,
      urgentBonusEligible: working && !!input.urgentBonus,
    } : {}),
  });
  return {
    hourlyRate: t.hourlyRateCents / 100,
    basePay: basePayCents / 100,
    laundryBonus: null,
    urgentBonus: receipt.urgentBonusCents ? receipt.urgentBonusCents / 100 : null,
    lateDeduction: receipt.lateDeductionCents ? receipt.lateDeductionCents / 100 : null,
    total: receipt.totalCents / 100,
    minimumTopUp: receipt.minimumTopUpCents / 100,
    leadPay: receipt.leadPayCents / 100,
    receipt,
  };
}
