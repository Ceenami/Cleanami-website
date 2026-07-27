import { db } from "@/db";
import { PriceDetails, SignupFormData } from "@/lib/validations/bookng-modal";
import { normalizeSignupFormDataForPricing } from "@/lib/validations/bookng-modal/serialize-signup-form";
import { resolveBasePrice } from "@/lib/pricing/base-price";
import { getSubscriptionDiscountRate } from "@/lib/pricing/subscription-discount";

export { getSubscriptionDiscountRate } from "@/lib/pricing/subscription-discount";

// v12 Pricing Rules §3 — "Large Property Surcharge: +$50 if Sq Ft > 1,800",
// applied to customer revenue (both in-unit and off-site). It sits on top of the
// normal per-500-sq-ft surcharge and does not affect cleaner pay.
const LARGE_PROPERTY_SURCHARGE = 50;
const LARGE_PROPERTY_SQFT_THRESHOLD = 1800;

type PricingRules = Awaited<ReturnType<typeof loadPricingRules>>;

/**
 * The booking form reprices on every edit, and four round trips per keystroke
 * is what made the price visibly lag behind the form. The rule tables are a few
 * dozen rows that only change from the admin pricing screen, so a short cache
 * removes the latency without letting an admin edit go unnoticed for long.
 * Kept module-level (per server instance) and deliberately short-lived.
 */
const RULES_CACHE_TTL_MS = 60_000;
let rulesCache: { rules: PricingRules; expiresAt: number } | null = null;
let rulesInFlight: Promise<PricingRules> | null = null;

async function loadPricingRules() {
  const [basePrices, sqftSurcharges, laundryRules, hotTubRules] =
    await Promise.all([
      db.query.basePricingRules.findMany(),
      db.query.sqftSurchargeRules.findMany(),
      db.query.laundryPricingRules.findMany(),
      db.query.hotTubPricingRules.findMany(),
    ]);

  return { basePrices, sqftSurcharges, laundryRules, hotTubRules };
}

async function getPricingRules(): Promise<PricingRules> {
  if (rulesCache && rulesCache.expiresAt > Date.now()) {
    return rulesCache.rules;
  }

  // Concurrent repricings share one query instead of stampeding the DB.
  rulesInFlight ??= loadPricingRules()
    .then((rules) => {
      // Never cache an empty read — that is the "pricing unavailable" signal,
      // and pinning it for a minute would hide a recovered database.
      if (rules.basePrices.length > 0) {
        rulesCache = { rules, expiresAt: Date.now() + RULES_CACHE_TTL_MS };
      }
      return rules;
    })
    .finally(() => {
      rulesInFlight = null;
    });

  return rulesInFlight;
}

/** Drops the cache so an admin pricing change is reflected immediately. */
export function invalidatePricingRulesCache(): void {
  rulesCache = null;
}

export class PricingService {
  public async calculatePrice(formData: SignupFormData): Promise<PriceDetails> {
    const normalized = normalizeSignupFormDataForPricing(formData);
    const rules = await getPricingRules();
    const {
      bedrooms = 0,
      bathrooms = 0,
      sqft = 0,
      subscriptionMonths = 1,
    } = normalized;

    // `null` = this bedroom/bathroom combination has no entry in the matrix
    // (over 5 beds/baths, or a fractional bath count such as 2.5). That is a
    // custom quote, NOT a $0 price — see `isCustomQuote` below.
    const resolvedBasePrice = resolveBasePrice(
      bedrooms,
      bathrooms,
      rules.basePrices
    );
    const basePrice = resolvedBasePrice ?? 0;
    const sqftSurcharge = this._calculateSqftSurcharge(
      sqft,
      rules.sqftSurcharges
    );
    // v12 §3: flat +$50 once the property is over 1,800 sq ft.
    const largePropertySurcharge =
      sqft > LARGE_PROPERTY_SQFT_THRESHOLD ? LARGE_PROPERTY_SURCHARGE : 0;
    const laundryCost = this._calculateLaundryCost(
      normalized,
      rules.laundryRules
    );
    const hotTubCost = this._calculateHotTubCost(normalized, rules.hotTubRules);

    // Admin per-property price override (task 1.9). When set, it IS the per-clean
    // price — base/surcharges/laundry/hot-tub and the term discount are bypassed
    // (an admin-negotiated price is final). Periodic hot-tub drain charges still
    // apply on top, since they are separate scheduled charges. New-customer
    // booking has no property yet, so no override; it flows in from the
    // recurring/one-off paths that pass the property's value.
    const overrideCents = (
      normalized as { priceOverrideCents?: number | null }
    ).priceOverrideCents;
    if (typeof overrideCents === "number" && overrideCents > 0) {
      const overridePrice = overrideCents / 100;
      return {
        basePrice: overridePrice,
        sqftSurcharge: 0,
        largePropertySurcharge: 0,
        laundryCost: 0,
        hotTubCost: 0,
        subtotalPerClean: overridePrice,
        discountRate: 0,
        discountAmount: 0,
        totalPerClean: overridePrice,
        isCustomQuote: false,
        pricingUnavailable: false,
        periodicCharges: hotTubCost.periodic,
      };
    }

    const customQuoteRule = rules.sqftSurcharges.find(
      (r: any) => r.isCustomQuote
    );
    const isOverSqftCeiling = customQuoteRule
      ? sqft >= customQuoteRule.rangeStart
      : false;

    // No rules loaded at all -> the pricing tables were never populated. That
    // is a misconfiguration, not a quotable property, and must not be reported
    // as a $0 price.
    const pricingUnavailable = rules.basePrices.length === 0;

    // Out of the matrix (>5 beds/baths, or a fractional bath count) is quotable
    // by hand, exactly like an over-ceiling sq ft.
    const isOutOfMatrix = !pricingUnavailable && resolvedBasePrice === null;

    const isCustomQuote = isOverSqftCeiling || isOutOfMatrix;

    const subtotalPerClean =
      basePrice +
      sqftSurcharge +
      largePropertySurcharge +
      laundryCost.total +
      hotTubCost.total;

    // Term discount applies to the recurring per-clean subtotal only (not the
    // periodic hot-tub drain charges). Round to cents to avoid float drift.
    const discountRate = getSubscriptionDiscountRate(subscriptionMonths);
    const discountAmount =
      Math.round(subtotalPerClean * discountRate * 100) / 100;
    const totalPerClean = subtotalPerClean - discountAmount;

    return {
      basePrice,
      sqftSurcharge,
      largePropertySurcharge,
      laundryCost: laundryCost.total,
      hotTubCost: hotTubCost.total,
      subtotalPerClean,
      discountRate,
      discountAmount,
      totalPerClean,
      isCustomQuote,
      pricingUnavailable,
      periodicCharges: hotTubCost.periodic,
    };
  }

  private _calculateSqftSurcharge(sqft: number, rules: any[]): number {
    const surchargeRule = rules.find(
      (s) => sqft >= s.rangeStart && sqft <= s.rangeEnd && !s.isCustomQuote
    );
    return surchargeRule ? surchargeRule.surchargeCents / 100 : 0;
  }

  private _calculateLaundryCost(
    formData: SignupFormData,
    rules: any[]
  ): { total: number } {
    const { laundryService, laundryLoads = 0 } = formData;
    const loads = Number(laundryLoads) || 0;

    const inUnitRule = rules.find((r) => r.serviceType === "In-Unit");
    const offSiteRule = rules.find((r) => r.serviceType === "Off-Site");

    if (laundryService === "in_unit" && inUnitRule) {
      const perLoadCost = inUnitRule.customerRevenuePerLoadCents / 100;
      return { total: loads * perLoadCost };
    }
    if (laundryService === "off_site" && loads > 0 && offSiteRule) {
      const baseCost = offSiteRule.customerRevenueBaseCents / 100;
      const perLoadCost = offSiteRule.customerRevenuePerLoadCents / 100;
      return { total: baseCost + loads * perLoadCost };
    }
    return { total: 0 };
  }

  private _calculateHotTubCost(
    formData: SignupFormData,
    rules: any[]
  ): { total: number; periodic: any[] } {
    const { hasHotTub, hotTubService, hotTubDrainCadence, hotTubDrain } =
      formData;
    if (!hasHotTub) return { total: 0, periodic: [] };

    const basicRule = rules.find((r) => r.serviceType === "Basic");
    const drainRule = rules.find((r) => r.serviceType === "Full_Drain");

    let total = 0;
    const periodic = [];

    if (hotTubService === true && basicRule) {
      total = basicRule.customerRevenueCents / 100;
    }
    if (hotTubDrain === true && drainRule) {
      periodic.push({
        description: "Hot Tub Full Drain & Refill",
        amount: drainRule.customerRevenueCents / 100,
        cadence: hotTubDrainCadence,
      });
    }
    return { total, periodic };
  }
}
