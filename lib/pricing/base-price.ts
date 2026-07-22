/**
 * Base price lookup against the bedroom x bathroom matrix
 * (`base_pricing_rules`, populated by CSV upload in the admin console).
 *
 * Kept free of database imports so it can be exercised on its own.
 */

export type BasePricingRule = {
  bedrooms: number;
  price1BathCents: number;
  price2BathCents: number;
  price3BathCents: number;
  price4BathCents: number;
  price5BathCents: number;
};

/**
 * Dollar base price for a bedroom/bathroom pair, or `null` when the matrix has
 * no entry for it.
 *
 * `null` rather than 0 is the whole point: "this property costs nothing" and
 * "we cannot price this property" are different answers, and collapsing them
 * onto 0 is what let an unpriceable property render as a blank price panel.
 * The matrix covers whole bathroom counts 1-5 only, so 6+ bedrooms, 6+
 * bathrooms and fractional counts such as 2.5 all correctly miss.
 */
export function resolveBasePrice(
  beds: number,
  baths: number,
  rules: readonly BasePricingRule[]
): number | null {
  const bedRule = rules.find((r) => r.bedrooms === beds);
  if (!bedRule) return null;

  const priceInCents = (bedRule as unknown as Record<string, unknown>)[
    `price${baths}BathCents`
  ];
  if (typeof priceInCents !== "number") return null;

  return priceInCents / 100;
}
