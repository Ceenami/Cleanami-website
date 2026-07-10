import { db } from "@/db";
import { PriceDetails, SignupFormData } from "@/lib/validations/bookng-modal";
import { normalizeSignupFormDataForPricing } from "@/lib/validations/bookng-modal/serialize-signup-form";

export class PricingService {
  public async calculatePrice(formData: SignupFormData): Promise<PriceDetails> {
    const normalized = normalizeSignupFormDataForPricing(formData);
    const [basePrices, sqftSurcharges, laundryRules, hotTubRules] =
      await Promise.all([
        db.query.basePricingRules.findMany(),
        db.query.sqftSurchargeRules.findMany(),
        db.query.laundryPricingRules.findMany(),
        db.query.hotTubPricingRules.findMany(),
      ]);

    const rules = { basePrices, sqftSurcharges, laundryRules, hotTubRules };
    const { bedrooms = 0, bathrooms = 0, sqft = 0 } = normalized;

    const basePrice = this._calculateBasePrice(
      bedrooms,
      bathrooms,
      rules.basePrices
    );
    const sqftSurcharge = this._calculateSqftSurcharge(
      sqft,
      rules.sqftSurcharges
    );
    const laundryCost = this._calculateLaundryCost(
      normalized,
      rules.laundryRules
    );
    const hotTubCost = this._calculateHotTubCost(normalized, rules.hotTubRules);

    const customQuoteRule = rules.sqftSurcharges.find(
      (r: any) => r.isCustomQuote
    );
    const isCustomQuote = customQuoteRule
      ? sqft >= customQuoteRule.rangeStart
      : false;

    const totalPerClean =
      basePrice + sqftSurcharge + laundryCost.total + hotTubCost.total;

    return {
      basePrice,
      sqftSurcharge,
      laundryCost: laundryCost.total,
      hotTubCost: hotTubCost.total,
      totalPerClean,
      isCustomQuote,
      periodicCharges: hotTubCost.periodic,
    };
  }

  private _calculateBasePrice(
    beds: number,
    baths: number,
    rules: any[]
  ): number {
    const bedRule = rules.find((r) => r.bedrooms === beds);
    if (!bedRule) return 0;

    const priceInCents = bedRule[`price${baths}BathCents`];
    return priceInCents ? priceInCents / 100 : 0;
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
