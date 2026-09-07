import { calculateJobStaffing } from "@/lib/pricing/staffing-logic";
import type { PriceDetails } from "@/lib/validations/bookng-modal";
import {
  CUSTOM_QUOTE_RESIDENTIAL_MESSAGE,
  LAUNDRY_LOADS_INCOMPLETE_MESSAGE,
} from "@/lib/pricing/custom-quote-message";

/**
 * Maps a residential one-time clean onto PricingService.calculatePrice.
 *
 * Sibling of recurring-pricing-input.ts: one engine, two input builders. A
 * second pricing implementation is how two flows start to overwrite each other,
 * so nothing here computes a price — it only fixes the inputs a residential
 * clean doesn't offer:
 *
 *   laundryService 'none'  Not offered. Forcing 'none' is also what makes
 *                          getTeamSize return the in-unit column (1/1/2)
 *                          rather than the off-site one (1/2/3).
 *   laundryLoads null      No service, so no load count. Keeps
 *                          laundryLoadsMissing false, which would otherwise
 *                          refuse the booking.
 *   hot tub                Basic service is optional and uses the same shared
 *                          pricing and staffing rules as vacation rentals.
 *   subscriptionMonths 1   No term, so no term discount — the discount tiers
 *                          start at 3 months.
 *
 * priceOverrideCents is absent because there is no property row yet at quote
 * time. If an admin sets an override later, the recurring and one-off paths
 * pass it and it wins there.
 */
export type ResidentialPricingInput = {
  bedCount: number;
  bathCount: string | number;
  sqFt: number | null;
  /** "Are pets normally present in the home?" */
  petsAllowed: boolean;
  hasHotTub: boolean;
  hotTubService: boolean;
};

export function buildResidentialPricingInput(property: ResidentialPricingInput) {
  return {
    bedrooms: Number(property.bedCount),
    bathrooms: Number(property.bathCount),
    sqft: property.sqFt || 0,
    laundryService: "none" as const,
    laundryLoads: null,
    hasHotTub: Boolean(property.hasHotTub),
    hotTubService: Boolean(property.hasHotTub && property.hotTubService),
    hotTubDrain: false,
    hotTubDrainCadence: null,
    petsAllowed: Boolean(property.petsAllowed),
    // No term, therefore no discount. See the note above.
    subscriptionMonths: 1,
  };
}

/**
 * The full "can we sell this online?" decision for a residential booking.
 * Returns a customer-facing refusal, or `null` when the quote stands.
 *
 * Price alone is not enough, because "custom" means two unrelated things:
 *
 *   pricing   isCustomQuote — over the sq ft ceiling or outside the bed/bath
 *             matrix. Already guarded on every charging path.
 *   staffing  classifyPropertySize returns "custom" (bed+bath >= 10, or >= 6
 *             beds, or >= 5 baths, or >= 3000 sq ft) and getTeamSize returns
 *             teamSize: null, requiresManualStaffing: true. Nothing reads that
 *             flag as a gate, and the assignment engine collapses the null
 *             with `?? 1`.
 *
 * Those are not the same set. A 5 bed / 5 bath house IS in the base matrix, so
 * isCustomQuote is false and it books and charges normally — but bed+bath is 10,
 * so it is staffing-custom, and it would be auto-assigned a SINGLE cleaner at
 * the one size the table declines to staff. The engine reports success.
 *
 * Latent on rentals, where nobody types their own counts. The residential form
 * is what makes it reachable, so this is where it gets closed.
 */
export function residentialQuoteRefusal(
  priceDetails: Pick<
    PriceDetails,
    "isCustomQuote" | "pricingUnavailable" | "laundryLoadsMissing"
  >,
  property: ResidentialPricingInput
): { reason: "pricing_unavailable" | "custom_quote"; message: string } | null {
  // A misconfiguration, never a $0 price. The customer must not be quoted.
  if (priceDetails.pricingUnavailable) {
    return {
      reason: "pricing_unavailable",
      message: CUSTOM_QUOTE_RESIDENTIAL_MESSAGE,
    };
  }

  if (priceDetails.isCustomQuote) {
    return { reason: "custom_quote", message: CUSTOM_QUOTE_RESIDENTIAL_MESSAGE };
  }

  // Should be unreachable — residential forces laundryService 'none' — but an
  // unreachable guard that quietly becomes reachable is how the laundry-at-$0
  // defect behaved before 0034.
  if (priceDetails.laundryLoadsMissing) {
    return { reason: "custom_quote", message: LAUNDRY_LOADS_INCOMPLETE_MESSAGE };
  }

  // The staffing half, from the same fixed inputs the price used.
  const staffing = calculateJobStaffing({
    bedCount: Number(property.bedCount),
    bathCount: property.bathCount,
    sqFt: property.sqFt,
    laundryType: "none",
    hotTubServiceLevel: property.hasHotTub && property.hotTubService,
    hotTubDeepClean: false,
  });
  if (staffing.requiresManualStaffing || staffing.teamSize === null) {
    return { reason: "custom_quote", message: CUSTOM_QUOTE_RESIDENTIAL_MESSAGE };
  }

  return null;
}
