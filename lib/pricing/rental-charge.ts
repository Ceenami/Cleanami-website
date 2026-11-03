import { z } from "zod";
import type { PriceDetails, SignupFormData } from "@/lib/validations/bookng-modal";
import { buildRecurringPricingInput, type RecurringPricingProperty } from "@/lib/pricing/recurring-pricing-input";

export class RentalPricingError extends Error {}

const cents = z.number().int().nonnegative().safe();
const drainCadenceSchema = z.enum(["4_weeks", "6_weeks", "2_months", "3_months", "4_months"]);
const chargeSchema = z.object({
  version: z.literal("rental-charge-v1"),
  perCleanCents: cents.min(50),
  drainDue: z.boolean(),
  drainCents: cents,
  drainCadence: drainCadenceSchema.nullable(),
  amountCents: cents.min(50),
  chargeAmountCents: cents,
  skippedPayment: z.boolean(),
  promo: z.object({
    promoCodeId: z.string().min(1),
    code: z.string().min(1),
    discountAmountCents: cents,
  }).strict().nullable(),
}).strict().superRefine((q, ctx) => {
  if (q.amountCents !== q.perCleanCents + q.drainCents ||
      (!q.drainDue && q.drainCents !== 0) ||
      (q.drainDue && !q.drainCadence) ||
      (q.skippedPayment ? q.chargeAmountCents !== 0 || q.promo !== null :
        q.chargeAmountCents < 50 || q.chargeAmountCents + (q.promo?.discountAmountCents ?? 0) !== q.amountCents))
    ctx.addIssue({ code: "custom", message: "Rental charge does not reconcile" });
});

export type RentalCharge = z.infer<typeof chargeSchema>;
export type RentalJobAddons = {
  hotTubServiceLevel?: string | null;
  hotTubDrainCadence?: string | null;
};

/** A nullable billing column predates this receipt; present corrupt data fails closed. */
export function readRentalCharge(value: unknown): RentalCharge | null {
  if (value === undefined || value === null) return null;
  const result = chargeSchema.safeParse(value);
  if (!result.success) throw new RentalPricingError("The frozen rental charge needs review. No authorization was attempted.");
  return result.data;
}

/** The issued job says which tub work is due; a later property edit cannot add
 * work or remove an already scheduled drain from this visit's charge. */
export function rentalJobPricingInput(
  property: RecurringPricingProperty,
  months: number,
  snapshot: RentalJobAddons | null,
): SignupFormData & { priceOverrideCents: number | null } {
  const input = buildRecurringPricingInput(property, months);
  const level = snapshot?.hotTubServiceLevel;
  if (level === "none" || level === "basic" || level === "deep_clean") {
    input.hasHotTub = level !== "none";
    input.hotTubService = level !== "none";
    input.hotTubDrain = level === "deep_clean";
    input.hotTubDrainCadence = snapshot?.hotTubDrainCadence ?? null;
  } else if (property.hotTubDrain) {
    throw new RentalPricingError("This job has no recorded hot-tub service plan. Please review its scope before billing.");
  }
  const laundryService = input.laundryService;
  if (laundryService !== "none" && laundryService !== "in_unit" && laundryService !== "off_site")
    throw new RentalPricingError("This job has an unsupported laundry service. Please review its scope before billing.");
  const cadence = input.hotTubDrainCadence ? drainCadenceSchema.safeParse(input.hotTubDrainCadence) : null;
  if (cadence && !cadence.success)
    throw new RentalPricingError("This job has an unsupported hot-tub cadence. Please review its scope before billing.");
  return {
    ...input, laundryService,
    laundryLoads: input.laundryLoads ?? undefined,
    hotTubDrainCadence: cadence?.success ? cadence.data : undefined,
  };
}

export function buildRentalCharge(
  price: PriceDetails,
  snapshot: RentalJobAddons | null,
  skippedPayment: boolean,
): RentalCharge {
  const drainDue = snapshot?.hotTubServiceLevel === "deep_clean";
  const drainCadence = drainDue ? snapshot?.hotTubDrainCadence ?? null : null;
  if (drainDue && (!drainCadence || price.periodicCharges.length !== 1 || price.periodicCharges[0].cadence !== drainCadence))
    throw new RentalPricingError("The scheduled hot-tub drain charge is not configured. Please review this job before billing.");
  const perCleanCents = Math.round(price.totalPerClean * 100);
  const drainCents = drainDue ? Math.round(price.periodicCharges[0].amount * 100) : 0;
  const amountCents = perCleanCents + drainCents;
  return readRentalCharge({
    version: "rental-charge-v1", perCleanCents, drainDue, drainCents, drainCadence,
    amountCents, chargeAmountCents: skippedPayment ? 0 : amountCents,
    skippedPayment, promo: null,
  })!;
}
