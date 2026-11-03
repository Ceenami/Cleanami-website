import { readResidentialSnapshot } from "@/lib/pricing/residential-v2/contracts";

/** Purchased-scope allowlist. Never serialize the pricing snapshot to customers. */
export function residentialCustomerScope(addons: unknown): string[] {
  const version = (
    addons as { residentialPricing?: { ruleVersion?: string } } | null
  )?.residentialPricing?.ruleVersion;
  if (version !== "residential-v2") return [];
  const frozen = readResidentialSnapshot(addons);
  if (frozen.kind !== "v2") return [];
  const input = frozen.terms.input;
  return [
    ...(input.cleaningLevel === "deep"
      ? ["Interior oven and refrigerator included."]
      : []),
    ...(input.hotTub === "basic"
      ? ["Basic hot-tub care."]
      : input.hotTub === "full"
        ? ["Hot-tub drain, clean and refill."]
        : []),
    ...(input.inUnitLaundryLoads > 0
      ? [`${input.inUnitLaundryLoads} in-unit laundry load(s).`]
      : []),
  ];
}
