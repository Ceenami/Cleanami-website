import { z } from "zod";
import { calculateResidentialV2, residentialV2InputSchema } from "./model";
import { V2_CONFIG_HASH, V2_CONFIG_REVISION, V2_RULES } from "./rules";
import { Decimal } from "./decimal";
import { V2_EXECUTION_POLICY, executionPayComponents } from "./execution-policy";

const cents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const hours = z.number().finite().min(0).max(1000000);
export const assignmentPayTermsSchema = z
  .object({
    version: z.literal("residential-v2"),
    configHash: z.literal(V2_CONFIG_HASH),
    policyRevision: z.literal("flat_1900_min_5500"),
    hourlyRateCents: cents.positive(),
    minimumBaseCents: cents,
    baseHours: hours.positive(),
    leadHours: hours,
    addonLead: z.boolean(),
    hotTub: z.enum(["none", "basic", "full"]),
    inUnitLaundryLoads: z.number().int().min(0).max(2),
  })
  .strict();
export type ResidentialAssignmentPayTerms = z.infer<
  typeof assignmentPayTermsSchema
>;
export const payReceiptSchema = z
  .object({
    version: z.literal("residential-v2"),
    configHash: z.literal(V2_CONFIG_HASH),
    policyRevision: z.literal("flat_1900_min_5500"),
    role: z.string().min(1),
    baseHours: hours,
    hourlyRateCents: cents,
    minimumBaseCents: cents,
    hourlyBaseCents: cents,
    minimumTopUpCents: cents,
    basePayCents: cents,
    leadHours: hours,
    leadPayCents: cents,
    urgentBonusCents: cents,
    lateDeductionCents: cents,
    totalCents: cents,
    settlement: z.enum(["completed", "late_cancellation", "removed"]),
    executionPolicy: z.literal(V2_EXECUTION_POLICY).optional(),
    arrivalDelayMinutes: z.number().finite().min(0).optional(),
    urgentBonusEligible: z.boolean().optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    const working = ["primary", "laundry_lead"].includes(r.role);
    const shadow = ["backup", "on-call"].includes(r.role);
    const hourlyBase = Decimal.of(r.baseHours)
      .mul(V2_RULES.CLEANER_PAY_RATE)
      .cents();
    const basePay = working
      ? Math.max(V2_RULES.MINIMUM_PAY_PER_CLEANER * 100, hourlyBase)
      : 0;
    const prospective = r.executionPolicy === V2_EXECUTION_POLICY;
    const adjustments = executionPayComponents({
      basePayCents: basePay,
      leadPayCents: Decimal.of(r.leadHours).mul(V2_RULES.CLEANER_PAY_RATE).cents(),
      urgentBonusEligible: working && !!r.urgentBonusEligible,
      arrivalDelayMinutes: r.arrivalDelayMinutes ?? 0,
      settlement: r.settlement,
    });
    if (
      (!working && !shadow) ||
      (!prospective && (r.settlement !== "completed" || r.arrivalDelayMinutes !== undefined || r.urgentBonusEligible !== undefined)) ||
      (prospective && (r.arrivalDelayMinutes === undefined || r.urgentBonusEligible === undefined ||
        r.settlement !== adjustments.settlement ||
        (r.settlement !== "completed" && r.leadHours !== 0) ||
        (r.settlement === "late_cancellation" && r.arrivalDelayMinutes !== 0))) ||
      r.hourlyRateCents !== V2_RULES.CLEANER_PAY_RATE * 100 ||
      r.minimumBaseCents !==
        (working ? V2_RULES.MINIMUM_PAY_PER_CLEANER * 100 : 0) ||
      (working && r.baseHours <= 0) ||
      (!working && (r.baseHours !== 0 || r.leadHours !== 0)) ||
      Decimal.of(r.baseHours).up(V2_RULES.PAID_HOUR_INCREMENT).number() !==
        r.baseHours ||
      Decimal.of(r.leadHours).up(V2_RULES.PAID_HOUR_INCREMENT).number() !==
        r.leadHours ||
      r.hourlyBaseCents !== hourlyBase ||
      r.basePayCents !== basePay ||
      r.leadPayCents !== adjustments.leadPayCents ||
      r.urgentBonusCents !== (prospective ? adjustments.urgentBonusCents : 0) ||
      r.lateDeductionCents !== (prospective ? adjustments.lateDeductionCents : 0) ||
      r.hourlyBaseCents + r.minimumTopUpCents !== r.basePayCents ||
      r.basePayCents +
        r.leadPayCents +
        r.urgentBonusCents -
        r.lateDeductionCents !==
        r.totalCents
    )
      ctx.addIssue({
        code: "custom",
        message: "Payout receipt components do not reconcile",
      });
  });
export type ResidentialPayReceipt = z.infer<typeof payReceiptSchema>;

const snapshotSchema = z.object({
  ruleVersion: z.literal("residential-v2"),
  configHash: z.literal(V2_CONFIG_HASH),
  configRevision: z.literal(V2_CONFIG_REVISION),
  input: residentialV2InputSchema,
  inputIdentity: z.string(),
  quotedAmountCents: cents,
  amountChargedCents: cents,
  promoDiscountCents: cents,
  compedCents: cents,
  expectedHoursPerCleaner: hours.positive(),
  teamSize: z.number().int().min(1).max(3),
  operationalHours: hours.positive(),
  model: z.unknown(),
  modeledRules: z.unknown(),
  leadTaskPlan: z.unknown(),
  payRatePolicy: z.literal("flat_1900_min_5500"),
  executionPolicy: z.literal(V2_EXECUTION_POLICY).optional(),
  exception: z.enum(["owner_comp"]).nullable(),
});

/** Persisted JSON is untrusted at runtime. Explicit legacy/v1/v2 discrimination. */
export function readResidentialSnapshot(addons: unknown):
  | { kind: "legacy" }
  | { kind: "v1"; terms: Record<string, unknown> }
  | {
      kind: "v2";
      terms: z.infer<typeof snapshotSchema>;
      model: ReturnType<typeof calculateResidentialV2>;
    } {
  if (
    !addons ||
    typeof addons !== "object" ||
    !("residentialPricing" in addons)
  )
    return { kind: "legacy" };
  const value = (addons as { residentialPricing: unknown }).residentialPricing;
  if (!value || typeof value !== "object")
    throw new Error("Corrupt residential pricing snapshot");
  const v = value as Record<string, unknown>;
  if (v.ruleVersion === "residential-v1") {
    const parsed = z
      .object({
        ruleVersion: z.literal("residential-v1"),
        input: z.object({
          cleaningLevel: z.enum(["standard", "deep"]),
          bedrooms: z.number().int().positive(),
          bathrooms: z.number().int().positive(),
          sqft: z.number().finite().positive(),
          petsAllowed: z.boolean(),
        }),
        inputIdentity: z.string(),
        quotedAmountCents: cents,
        amountChargedCents: cents,
        promoDiscountCents: cents,
        compedCents: cents,
        expectedHoursPerCleaner: hours.positive(),
        teamSize: z.number().int().min(1).max(2),
      })
      .passthrough()
      .parse(v);
    return { kind: "v1", terms: parsed };
  }
  if (v.ruleVersion !== "residential-v2")
    throw new Error("Unsupported residential pricing snapshot");
  const terms = snapshotSchema.parse(v);
  const model = calculateResidentialV2(terms.input);
  const plan = z
    .object({
      hotTub: z.enum(["none", "basic", "full"]),
      inUnitLaundryLoads: z.number().int().min(0),
      paidHours: hours,
      requiresSpaQualification: z.boolean(),
    })
    .strict()
    .parse(terms.leadTaskPlan);
  const identity = JSON.stringify([
    "residential-v2",
    V2_CONFIG_HASH,
    terms.input.bedrooms,
    terms.input.bathrooms,
    terms.input.sqft,
    terms.input.cleaningLevel,
    terms.input.petsAllowed,
    terms.input.hotTub,
    terms.input.inUnitLaundryLoads,
  ]);
  if (
    terms.inputIdentity !== identity ||
    terms.quotedAmountCents !== model.amountCents ||
    terms.expectedHoursPerCleaner !== model.fields.I ||
    terms.teamSize !== model.fields.G ||
    terms.operationalHours < model.operationalActiveHours ||
    plan.hotTub !== terms.input.hotTub ||
    plan.inUnitLaundryLoads !== terms.input.inUnitLaundryLoads ||
    plan.paidHours !== model.leadPaidHours ||
    plan.requiresSpaQualification !== (terms.input.hotTub !== "none") ||
    terms.amountChargedCents + terms.promoDiscountCents + terms.compedCents !==
      terms.quotedAmountCents ||
    terms.promoDiscountCents !== 0 ||
    terms.compedCents > 0 !== (terms.exception === "owner_comp") ||
    !terms.modeledRules ||
    typeof terms.modeledRules !== "object" ||
    Object.keys(terms.modeledRules).length !== Object.keys(V2_RULES).length ||
    Object.entries(V2_RULES).some(
      ([key, value]) =>
        (terms.modeledRules as Record<string, unknown>)[key] !== value,
    ) ||
    !terms.model ||
    typeof terms.model !== "object" ||
    !("fields" in terms.model) ||
    !terms.model.fields ||
    typeof terms.model.fields !== "object" ||
    Object.entries(model.fields).some(
      ([key, value]) =>
        (terms.model as { fields: Record<string, unknown> }).fields[key] !==
        value,
    )
  )
    throw new Error("Corrupt frozen residential v2 economics");
  return { kind: "v2", terms, model };
}
