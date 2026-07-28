/**
 * Shared property -> `PricingService.calculatePrice` input mapping for
 * recurring (non-first) cleans. Previously duplicated between the
 * pre-authorize cron and the late-cancel charge path, and had drifted (the
 * cancellation copy was missing `priceOverrideCents`).
 */
export type RecurringPricingProperty = {
  bedCount: number;
  bathCount: string | number;
  sqFt: number | null;
  laundryType: string;
  laundryLoads: number | null;
  hasHotTub: boolean;
  hotTubServiceLevel: boolean;
  hotTubDrain: boolean;
  hotTubDrainCadence: string | null;
  priceOverrideCents?: number | null;
};

export function buildRecurringPricingInput(
  property: RecurringPricingProperty,
  subscriptionMonths: number
) {
  return {
    bedrooms: property.bedCount,
    bathrooms: Number(property.bathCount),
    sqft: property.sqFt || 0,
    laundryService: property.laundryType,
    laundryLoads: property.laundryLoads,
    hasHotTub: property.hasHotTub,
    hotTubService: property.hotTubServiceLevel,
    hotTubDrain: property.hotTubDrain,
    hotTubDrainCadence: property.hotTubDrainCadence,
    subscriptionMonths,
    // Admin per-property price override (task 1.9), applied to recurring
    // charges too when set.
    priceOverrideCents: property.priceOverrideCents ?? null,
  };
}
