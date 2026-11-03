import { z } from "zod";
import type { PriceDetails } from "@/lib/validations/bookng-modal";
import type { JobStaffingResult } from "@/lib/pricing/staffing-logic";
import { getAvailableArrivalWindows } from "@/lib/scheduling/arrival-windows";
import {
  calculateResidentialV2,
  residentialV2ReviewReasons,
  type ResidentialV2Input,
  type ResidentialV2Model,
} from "./residential-v2/model";
import {
  V2_CONFIG_HASH,
  V2_CONFIG_REVISION,
  V2_RULE_VERSION,
  V2_RULES,
} from "./residential-v2/rules";
import { V2_EXECUTION_POLICY, type V2ExecutionPolicy } from "./residential-v2/execution-policy";

/** Approved Residential v1 workbook, Rules and Residential Calculator sheets. */
export const RESIDENTIAL_RULE_VERSION = "residential-v1" as const;
export const RESIDENTIAL_CLEANING_LEVELS = ["standard", "deep"] as const;
export type ResidentialCleaningLevel =
  (typeof RESIDENTIAL_CLEANING_LEVELS)[number];

/** Pricing never requires identity, access instructions or an appointment. */
export const residentialQuoteInputSchema = z.object({
  bedrooms: z.number().int().min(1),
  bathrooms: z.number().int().min(1),
  sqft: z.number().finite().positive(),
  cleaningLevel: z.enum(RESIDENTIAL_CLEANING_LEVELS),
  petsAllowed: z.boolean().default(false),
});
export type ResidentialQuoteInput = z.infer<typeof residentialQuoteInputSchema>;

export type ResidentialV1Terms = {
  ruleVersion: typeof RESIDENTIAL_RULE_VERSION;
  input: ResidentialQuoteInput;
  inputIdentity: string;
  propertySize: "small" | "medium" | "large";
  amountCents: number;
  priceDetails: PriceDetails;
  expectedHoursPerCleaner: number;
  teamSize: 1 | 2;
  /** Estimate at workbook rate; actual approved worker rates still apply. */
  nominalPayPerCleanerCents: number;
  nominalLaborCents: number;
  laborOnlyProfitCents: number;
};
export type ResidentialV2Terms = Omit<
  ResidentialV1Terms,
  "ruleVersion" | "input" | "teamSize"
> & {
  ruleVersion: typeof V2_RULE_VERSION;
  configRevision: typeof V2_CONFIG_REVISION;
  configHash: typeof V2_CONFIG_HASH;
  input: ResidentialV2Input;
  teamSize: 1 | 2 | 3;
  operationalHours: number;
  model: ResidentialV2Model;
  executionPolicy?: V2ExecutionPolicy;
};
export type ResidentialTerms = ResidentialV1Terms | ResidentialV2Terms;
export type ResidentialRuleVersion = ResidentialTerms["ruleVersion"];
export type ResidentialEvaluation =
  | { ok: true; terms: ResidentialTerms }
  | { ok: false; reason: "validation" | "custom_quote"; error: string };

export function residentialInputIdentity(input: ResidentialQuoteInput): string {
  return JSON.stringify([
    RESIDENTIAL_RULE_VERSION,
    input.bedrooms,
    input.bathrooms,
    input.sqft,
    input.cleaningLevel,
    input.petsAllowed,
  ]);
}

export function evaluateResidentialPrice(
  input: unknown,
  version: ResidentialRuleVersion = RESIDENTIAL_RULE_VERSION,
): ResidentialEvaluation {
  if (version === V2_RULE_VERSION) return evaluateResidentialV2Price(input);
  if (version !== RESIDENTIAL_RULE_VERSION)
    return {
      ok: false,
      reason: "validation",
      error: "Unsupported residential pricing version.",
    };
  const parsed = residentialQuoteInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation",
      error:
        "Enter whole bedrooms and bathrooms, square footage, and choose Standard or Deep.",
    };
  }
  const data = parsed.data;
  const { bedrooms, bathrooms, sqft, cleaningLevel, petsAllowed } = data;
  const total = bedrooms + bathrooms;
  if (total >= 10 || bedrooms >= 6 || bathrooms >= 5 || sqft >= 3000) {
    return {
      ok: false,
      reason: "custom_quote",
      error:
        "This home needs a custom quote. Please contact CleanNami before booking.",
    };
  }
  // Workbook E5; the rental classifier and pricing remain separate.
  const propertySize =
    total > 7 || sqft > 1999
      ? "large"
      : total > 4 || sqft > 1250
        ? "medium"
        : "small";
  const teamSize = propertySize === "large" ? 2 : 1;
  const sqftAdjustment =
    sqft < 1000
      ? 0
      : sqft < 1500
        ? 10
        : sqft < 2000
          ? 15
          : sqft < 2500
            ? 30
            : 45;
  const standardCoreCents = Math.max(
    11000,
    (70 + 15 * bedrooms + 20 * bathrooms + sqftAdjustment) * 100,
  );
  const coreCents =
    cleaningLevel === "deep"
      ? Math.max(17000, Math.ceil((standardCoreCents * 145) / 50000) * 500)
      : standardCoreCents;
  const petFeeCents = petsAllowed ? 1000 : 0;
  const amountCents = coreCents + petFeeCents;
  // Time coefficients in 1/10,000h; round UP after applying team efficiency.
  const soloUnits =
    cleaningLevel === "deep"
      ? 3500 +
        7500 * bedrooms +
        9500 * bathrooms +
        9 * sqft +
        (petsAllowed ? 2500 : 0)
      : 2500 +
        4500 * bedrooms +
        6000 * bathrooms +
        6 * sqft +
        (petsAllowed ? 2500 : 0);
  const efficiencyPercent = teamSize === 2 ? 180 : 100;
  const expectedHoursPerCleaner =
    Math.ceil((soloUnits * 100) / (efficiencyPercent * 2500)) / 4;
  const nominalPayPerCleanerCents = Math.round(expectedHoursPerCleaner * 1700);
  const nominalLaborCents = nominalPayPerCleanerCents * teamSize;
  const priceDetails: PriceDetails = {
    basePrice: coreCents / 100,
    sqftSurcharge: 0,
    largePropertySurcharge: 0,
    laundryCost: 0,
    hotTubCost: 0,
    petFee: petFeeCents / 100,
    subtotalPerClean: amountCents / 100,
    discountRate: 0,
    discountAmount: 0,
    totalPerClean: amountCents / 100,
    isCustomQuote: false,
    pricingUnavailable: false,
    laundryLoadsMissing: false,
    periodicCharges: [],
  };
  return {
    ok: true,
    terms: {
      ruleVersion: RESIDENTIAL_RULE_VERSION,
      input: data,
      inputIdentity: residentialInputIdentity(data),
      propertySize,
      amountCents,
      priceDetails,
      expectedHoursPerCleaner,
      teamSize,
      nominalPayPerCleanerCents,
      nominalLaborCents,
      laborOnlyProfitCents: amountCents - nominalLaborCents,
    },
  };
}

export function residentialV2Identity(
  input: ResidentialV2Input,
  configHash: string = V2_CONFIG_HASH,
) {
  return JSON.stringify([
    V2_RULE_VERSION,
    configHash,
    input.bedrooms,
    input.bathrooms,
    input.sqft,
    input.cleaningLevel,
    input.petsAllowed,
    input.hotTub,
    input.inUnitLaundryLoads,
  ]);
}

function evaluateResidentialV2Price(input: unknown): ResidentialEvaluation {
  let model: ResidentialV2Model;
  try {
    model = calculateResidentialV2(input);
  } catch {
    return {
      ok: false,
      reason: "validation",
      error: "Enter valid home details and residential service selections.",
    };
  }
  if (residentialV2ReviewReasons(model).length)
    return {
      ok: false,
      reason: "custom_quote",
      error:
        "This scope needs operational review. Please contact CleanNami before booking.",
    };
  return { ok: true, terms: buildResidentialV2AnalysisTerms(model.input) };
}

/** Internal integration/analysis only. Public quote/sale policy is separate. */
export function buildResidentialV2AnalysisTerms(
  input: ResidentialV2Input,
): ResidentialV2Terms {
  const model = calculateResidentialV2(input);
  const f = model.fields;
  if (f.G === 4 || f.E === "MANSION / MANUAL")
    throw new Error(
      "Mansion/four-person economics are analysis-only model results",
    );
  const petFee = f.Q,
    hotTubCost = f.R,
    laundryCost = f.S;
  const amountCents = model.amountCents;
  // The service line absorbs a floor uplift; public lines still reconcile.
  const priceDetails: PriceDetails = {
    basePrice: amountCents / 100 - petFee - hotTubCost - laundryCost,
    sqftSurcharge: 0,
    largePropertySurcharge: 0,
    laundryCost,
    hotTubCost,
    petFee,
    subtotalPerClean: amountCents / 100,
    discountRate: 0,
    discountAmount: 0,
    totalPerClean: amountCents / 100,
    isCustomQuote: false,
    pricingUnavailable: false,
    laundryLoadsMissing: false,
    periodicCharges: [],
  };
  return {
    ruleVersion: V2_RULE_VERSION,
    executionPolicy: V2_EXECUTION_POLICY,
    configHash: V2_CONFIG_HASH,
    configRevision: V2_CONFIG_REVISION,
    input: model.input,
    inputIdentity: residentialV2Identity(model.input),
    propertySize: f.E.toLowerCase() as "small" | "medium" | "large",
    amountCents,
    priceDetails,
    expectedHoursPerCleaner: f.I,
    teamSize: f.G as 1 | 2 | 3,
    nominalPayPerCleanerCents: Math.round(f.J * 100),
    nominalLaborCents: Math.round(f.X * 100),
    laborOnlyProfitCents: amountCents - Math.round(f.X * 100),
    operationalHours: model.operationalActiveHours,
    model,
  };
}

export function residentialOperationalHours(terms: ResidentialTerms) {
  return terms.ruleVersion === V2_RULE_VERSION
    ? terms.operationalHours
    : terms.expectedHoursPerCleaner;
}

/** Public allowlist: expected hours, pay, team and margin remain internal. */
export function toPublicResidentialQuote(terms: ResidentialTerms) {
  if (
    terms.ruleVersion === V2_RULE_VERSION &&
    residentialV2ReviewReasons(terms.model).length
  )
    throw new Error("Manual analysis is not a sellable quote");
  return {
    refused: false as const,
    ruleVersion: terms.ruleVersion,
    inputIdentity: terms.inputIdentity,
    cleaningLevel: terms.input.cleaningLevel,
    amountCents: terms.amountCents,
    currency: "usd" as const,
    priceDetails: terms.priceDetails,
    arrivalWindowKeys: getAvailableArrivalWindows(
      residentialOperationalHours(terms),
    ).map((w) => w.key),
  };
}

/** New issued terms only: never call this to reprice an existing job. */
export function buildResidentialJobStaffing(
  terms: ResidentialTerms,
  amountChargedCents: number,
  promoDiscountCents = 0,
  compedCents = 0,
) {
  if (
    !Number.isSafeInteger(amountChargedCents) ||
    amountChargedCents < 0 ||
    !Number.isSafeInteger(promoDiscountCents) ||
    promoDiscountCents < 0 ||
    !Number.isSafeInteger(compedCents) ||
    compedCents < 0 ||
    amountChargedCents + promoDiscountCents + compedCents !== terms.amountCents
  ) {
    throw new Error("Residential snapshot amount mismatch");
  }
  if (terms.ruleVersion === V2_RULE_VERSION && promoDiscountCents > 0)
    throw new Error("Residential v2 discount policy is not approved");
  const v2 = terms.ruleVersion === V2_RULE_VERSION ? terms : null;
  const requiresManualStaffing = v2
    ? residentialV2ReviewReasons(v2.model).length > 0
    : false;
  const staffing: JobStaffingResult = {
    propertySize: terms.propertySize,
    bedroomBathroomTotal: terms.input.bedrooms + terms.input.bathrooms,
    baseCleaningHours: terms.expectedHoursPerCleaner,
    inUnitLaundryHours: v2
      ? v2.input.inUnitLaundryLoads * V2_RULES.INUNIT_LAUNDRY_HRS
      : 0,
    offSiteLaundryHours: 0,
    hotTubHours: v2
      ? v2.input.hotTub === "full"
        ? V2_RULES.HOT_FULL_ACTIVE_HRS
        : v2.input.hotTub === "basic"
          ? V2_RULES.HOT_BASIC_ACTIVE_HRS
          : 0
      : 0,
    expectedHoursPerCleaner: terms.expectedHoursPerCleaner,
    teamSize: terms.teamSize,
    requiresManualStaffing,
    expectedLaundryLoads: v2?.input.inUnitLaundryLoads ?? 0,
    // This legacy flag describes hot-tub deep service, not a residential level.
    isDeepClean: false,
  };
  return {
    expectedHours: String(terms.expectedHoursPerCleaner),
    staffing,
    addonsSnapshot: {
      laundryType: v2?.input.inUnitLaundryLoads ? "in_unit" : "none",
      laundryLoads: v2?.input.inUnitLaundryLoads ?? 0,
      hotTubServiceLevel: v2?.input.hotTub ?? "none",
      hotTubDrainCadence: null,
      petsAllowed: terms.input.petsAllowed,
      teamSize: terms.teamSize,
      propertySize: terms.propertySize,
      requiresManualStaffing,
      bedroomBathroomTotal: staffing.bedroomBathroomTotal,
      baseCleaningHours: staffing.baseCleaningHours,
      inUnitLaundryHours: staffing.inUnitLaundryHours,
      offSiteLaundryHours: 0,
      hotTubHours: staffing.hotTubHours,
      cleaningLevel: terms.input.cleaningLevel,
      residentialPricing: {
        ruleVersion: terms.ruleVersion,
        input: { ...terms.input },
        inputIdentity: terms.inputIdentity,
        quotedAmountCents: terms.amountCents,
        amountChargedCents,
        promoDiscountCents,
        compedCents,
        expectedHoursPerCleaner: terms.expectedHoursPerCleaner,
        teamSize: terms.teamSize,
        payRatePolicy: v2
          ? ("flat_1900_min_5500" as const)
          : ("approved_individual_rate_with_1700_fallback" as const),
        ...(v2
          ? {
              configRevision: v2.configRevision,
              ...(v2.executionPolicy ? { executionPolicy: v2.executionPolicy } : {}),
              configHash: v2.configHash,
              model: {
                ...v2.model,
                input: { ...v2.model.input },
                fields: { ...v2.model.fields },
              },
              operationalHours: v2.operationalHours,
              leadTaskPlan: {
                hotTub: v2.input.hotTub,
                inUnitLaundryLoads: v2.input.inUnitLaundryLoads,
                paidHours: v2.model.leadPaidHours,
                requiresSpaQualification: v2.input.hotTub !== "none",
              },
              modeledRules: { ...V2_RULES },
              exception: compedCents > 0 ? ("owner_comp" as const) : null,
            }
          : {}),
      },
    },
  };
}
