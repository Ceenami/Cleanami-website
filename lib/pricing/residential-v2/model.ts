import { z } from "zod";
import { Decimal as D } from "./decimal";
import { V2_RULES, type V2Rules } from "./rules";

// Resource/arithmetic bounds, not a customer layout allowlist. Manual analysis
// covers every workbook row; no unbounded numeric payload enters the model.
export const residentialV2InputSchema = z
  .object({
    cleaningLevel: z.enum(["standard", "deep"]),
    bedrooms: z.number().int().min(1).max(10000),
    bathrooms: z.number().int().min(1).max(10000),
    sqft: z.number().finite().positive().max(100000000),
    petsAllowed: z.boolean(),
    hotTub: z.enum(["none", "basic", "full"]),
    inUnitLaundryLoads: z.number().int().min(0).max(10000),
  })
  .strict();
export type ResidentialV2Input = z.infer<typeof residentialV2InputSchema>;

export function validateV2Rules(input: V2Rules): Readonly<V2Rules> {
  const keys = Object.keys(V2_RULES) as (keyof V2Rules)[];
  if (
    Object.keys(input).length !== keys.length ||
    keys.some(
      (key) =>
        !Number.isFinite(input[key]) || input[key] < 0 || input[key] > 1000000,
    )
  )
    throw new Error("Invalid residential v2 configuration");
  for (const key of [
    "CREW1_EFF",
    "CREW2_EFF",
    "CREW3_EFF",
    "CREW4_EFF",
    "TARGET_APPOINTMENT_HOURS",
    "PAID_HOUR_INCREMENT",
    "PRICE_ROUND_INCREMENT",
    "SQFT_STEP_SIZE",
  ] as const)
    if (input[key] <= 0)
      throw new Error("Positive configuration divisor/increment required");
  if (
    D.of(1)
      .sub(input.MARGIN_FLOOR)
      .sub(input.CARD_PERCENT)
      .sub(input.QUALITY_RESERVE)
      .lte(0)
  )
    throw new Error("Positive contribution divisor required");
  return Object.freeze({ ...input });
}

/** Workbook A:AI, including its literal status/note, independent of sale policy. */
export function calculateResidentialV2(
  input: unknown,
  configuration: V2Rules = V2_RULES,
) {
  const v = residentialV2InputSchema.parse(input);
  const r = validateV2Rules(configuration);
  const { bedrooms: b, bathrooms: a, sqft: s, inUnitLaundryLoads: l } = v;
  const deep = v.cleaningLevel === "deep",
    pets = v.petsAllowed ? 1 : 0;
  const mansion =
    s >= r.LEGACY_CUSTOM_MIN_SQFT ||
    b >= r.LEGACY_CUSTOM_BEDS ||
    a >= r.LEGACY_CUSTOM_BATHS ||
    a + b >= r.LEGACY_CUSTOM_TOTAL;
  const homeClass = mansion
    ? "MANSION / MANUAL"
    : s >= 2000 || a + b >= 8
      ? "LARGE"
      : s > 1250 || a + b >= 5
        ? "MEDIUM"
        : "SMALL";
  const solo = deep
    ? D.of(r.DEEP_TIME_BASE)
        .add(D.of(b).mul(r.DEEP_HOURS_BED))
        .add(D.of(a).mul(r.DEEP_HOURS_BATH))
        .add(D.of(s).mul(r.DEEP_HOURS_SQFT))
        .add(r.DEEP_OVEN_FRIDGE)
        .add(D.of(pets).mul(r.PET_TIME))
    : D.of(r.STD_TIME_BASE)
        .add(D.of(b).mul(r.STD_HOURS_BED))
        .add(D.of(a).mul(r.STD_HOURS_BATH))
        .add(D.of(s).mul(r.STD_HOURS_SQFT))
        .add(D.of(pets).mul(r.PET_TIME));
  const efficiencies = [r.CREW1_EFF, r.CREW2_EFF, r.CREW3_EFF, r.CREW4_EFF];
  const crew = (
    solo.lte(D.of(r.TARGET_APPOINTMENT_HOURS).mul(efficiencies[0]))
      ? 1
      : solo.lte(D.of(r.TARGET_APPOINTMENT_HOURS).mul(efficiencies[1]))
        ? 2
        : solo.lte(D.of(r.TARGET_APPOINTMENT_HOURS).mul(efficiencies[2]))
          ? 3
          : 4
  ) as 1 | 2 | 3 | 4;
  const efficiency = efficiencies[crew - 1];
  const baseHours = solo.div(efficiency).up(r.PAID_HOUR_INCREMENT);
  const basePay = baseHours
    .mul(r.CLEANER_PAY_RATE)
    .max(r.MINIMUM_PAY_PER_CLEANER);
  const teamPay = basePay.mul(crew);
  const sqftFee =
    s < 1000
      ? D.of(0)
      : s < 1500
        ? D.of(10)
        : s < 2000
          ? D.of(15)
          : s < 2500
            ? D.of(30)
            : s < 3000
              ? D.of(45)
              : D.of(45).add(
                  D.of(s)
                    .sub(2999)
                    .div(r.SQFT_STEP_SIZE)
                    .up(1)
                    .mul(r.SQFT_PRICE_STEP_ABOVE_3000),
                );
  const standard = D.of(r.STD_CORE_BASE)
    .add(D.of(b).mul(r.PRICE_PER_BED))
    .add(D.of(a).mul(r.PRICE_PER_BATH))
    .add(sqftFee)
    .max(r.STD_MIN_PRICE);
  const core = deep
    ? standard
        .mul(r.DEEP_MULTIPLIER)
        .up(r.PRICE_ROUND_INCREMENT)
        .max(r.DEEP_MIN_PRICE)
    : standard;
  const petRevenue = D.of(pets).mul(r.PET_FEE);
  const hotRevenue = D.of(
    v.hotTub === "basic"
      ? r.HOT_BASIC_PRICE
      : v.hotTub === "full"
        ? r.HOT_FULL_PRICE
        : 0,
  );
  const hotHours = D.of(
    v.hotTub === "basic"
      ? r.HOT_BASIC_ACTIVE_HRS
      : v.hotTub === "full"
        ? r.HOT_FULL_ACTIVE_HRS
        : 0,
  );
  const laundryRevenue = D.of(l).mul(r.INUNIT_LAUNDRY_PRICE);
  const leadRawHours = hotHours.add(D.of(l).mul(r.INUNIT_LAUNDRY_HRS));
  const leadPaidHours = leadRawHours.up(r.PAID_HOUR_INCREMENT);
  const extraPay = leadPaidHours.mul(r.CLEANER_PAY_RATE);
  const materials = D.of(deep ? r.DEEP_SUPPLIES : r.STANDARD_SUPPLIES)
    .add(
      v.hotTub === "basic"
        ? r.HOT_BASIC_MATERIALS
        : v.hotTub === "full"
          ? r.HOT_FULL_MATERIALS
          : 0,
    )
    .add(D.of(l).mul(r.INUNIT_LAUNDRY_MATERIALS));
  const allowance = D.of(r.OPERATIONS_ALLOWANCE).add(r.PAYOUT_ALLOWANCE);
  const totalPay = teamPay.add(extraPay);
  const listed = core.add(petRevenue).add(hotRevenue).add(laundryRevenue);
  const divisor = D.of(1)
    .sub(r.MARGIN_FLOOR)
    .sub(r.CARD_PERCENT)
    .sub(r.QUALITY_RESERVE);
  const floor = totalPay
    .add(materials)
    .add(allowance)
    .add(r.CARD_FIXED)
    .div(divisor)
    .up(r.PRICE_ROUND_INCREMENT);
  const price = listed.max(floor); // Literal Excel MAX, no extra final ceiling.
  const card = price.mul(r.CARD_PERCENT).add(r.CARD_FIXED);
  const reserve = price.mul(r.QUALITY_RESERVE);
  const cost = totalPay.add(materials).add(allowance).add(card).add(reserve);
  const contribution = price.sub(cost);
  const margin = price.lte(0) ? D.of(0) : contribution.div(price);
  const overTarget = !baseHours.lte(r.TARGET_APPOINTMENT_HOURS);
  const fields = {
    A: b,
    B: a,
    C: s,
    D: b + a,
    E: homeClass,
    F: solo.number(),
    G: crew,
    H: efficiency,
    I: baseHours.number(),
    J: basePay.number(),
    K: teamPay.number(),
    L: sqftFee.number(),
    M: core.number(),
    N: pets,
    O: v.hotTub === "none" ? "None" : v.hotTub === "basic" ? "Basic" : "Full",
    P: l,
    Q: petRevenue.number(),
    R: hotRevenue.number(),
    S: laundryRevenue.number(),
    T: leadRawHours.number(),
    U: extraPay.number(),
    V: materials.number(),
    W: allowance.number(),
    X: totalPay.number(),
    Y: listed.number(),
    Z: floor.number(),
    AA: price.number(),
    AB: card.number(),
    AC: reserve.number(),
    AD: cost.number(),
    AE: contribution.number(),
    AF: margin.number(),
    AG: D.of(r.MARGIN_FLOOR).lte(margin.add(0.0000001)) ? "PASS" : "FAIL",
    AH:
      mansion || overTarget || crew >= 4 || l > 2
        ? "MANUAL REVIEW"
        : "CURRENT SIZE RANGE",
    AI: overTarget
      ? "Crew max exceeded - bespoke schedule"
      : crew >= 4
        ? "Four-cleaner crew: validate coverage"
        : v.hotTub === "full"
          ? "Confirm spa training and refill timing"
          : l > 2
            ? "Laundry cycles need approval"
            : "None",
  };
  return {
    input: v,
    fields,
    leadPaidHours: leadPaidHours.number(),
    operationalActiveHours: baseHours.add(leadPaidHours).number(),
    amountCents: price.cents(),
  };
}
export type ResidentialV2Model = ReturnType<typeof calculateResidentialV2>;

/** All reasons are returned; the spreadsheet's AH label is not booking authority. */
export function residentialV2ReviewReasons(model: ResidentialV2Model) {
  const reasons: string[] = [];
  if (model.fields.E === "MANSION / MANUAL") reasons.push("mansion");
  if (model.fields.G === 4) reasons.push("four_cleaners");
  if (model.fields.I > V2_RULES.TARGET_APPOINTMENT_HOURS)
    reasons.push("base_target_exceeded");
  if (model.operationalActiveHours > V2_RULES.TARGET_APPOINTMENT_HOURS)
    reasons.push("lead_target_exceeded");
  if (model.operationalActiveHours > 7) reasons.push("operating_day_exceeded");
  if (model.input.inUnitLaundryLoads > 2) reasons.push("laundry_load_review");
  // Workbook specifies active work, not elapsed cycles/refill. Until accepted
  // feasibility/qualification policies exist these selections cannot be sold.
  if (model.input.hotTub !== "none") reasons.push("spa_elapsed_policy_pending");
  if (model.input.inUnitLaundryLoads > 0)
    reasons.push("laundry_elapsed_qualification_policy_pending");
  return reasons;
}
