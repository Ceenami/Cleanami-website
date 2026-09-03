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
  /**
   * REQUIRED, not optional, on purpose. A recurring VR clean re-prices from the
   * property on the night before every charge, so a path that forgets to pass
   * this bills a pet property $10 short on every clean after the first —
   * silently, for as long as nobody adds it up. Required means the compiler
   * finds each call site instead.
   */
  petsAllowed: boolean;
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
    petsAllowed: property.petsAllowed,
    subscriptionMonths,
    // Admin per-property price override (task 1.9), applied to recurring
    // charges too when set.
    priceOverrideCents: property.priceOverrideCents ?? null,
  };
}
