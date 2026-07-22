/**
 * Subscription-term discount on the recurring per-clean price.
 *
 * Single source of truth for this rule. Deliberately free of database and
 * `server-only` imports so the booking UI can show the same tiers it will be
 * charged, rather than keeping its own copy that can drift.
 */

/** Discount tiers, longest term first. */
export const SUBSCRIPTION_DISCOUNT_TIERS = [
  { minMonths: 6, rate: 0.15 },
  { minMonths: 3, rate: 0.1 },
] as const;

/**
 * Fractional discount for a term length.
 * Threshold-based so a longer term never earns a smaller discount:
 *   >= 6 months -> 15%,  >= 3 months -> 10%,  otherwise 0%.
 * (Client spec: 3 months = 10%, 6 months = 15%.)
 */
export function getSubscriptionDiscountRate(subscriptionMonths: number): number {
  const months = Number(subscriptionMonths) || 0;
  const tier = SUBSCRIPTION_DISCOUNT_TIERS.find((t) => months >= t.minMonths);
  return tier?.rate ?? 0;
}

/** The same rate as a whole-number percentage, for display. */
export function getSubscriptionDiscountPercent(subscriptionMonths: number): number {
  return Math.round(getSubscriptionDiscountRate(subscriptionMonths) * 100);
}
