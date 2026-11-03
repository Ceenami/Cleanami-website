import "server-only";
import {
  evaluateResidentialPrice,
  type ResidentialRuleVersion,
} from "./residential";
import { V2_CONFIG_HASH } from "./residential-v2/rules";

/** New sales follow reviewed source. Historical checkout readers remain versioned. */
export function activeResidentialSaleVersion(): ResidentialRuleVersion {
  return "residential-v2";
}

export function evaluateResidentialSale(input: unknown) {
  const version = activeResidentialSaleVersion();
  const v = input as Record<string, unknown> | null;
  if (!Number.isSafeInteger(v?.sqft) || Number(v?.sqft) <= 0)
    return { ok: false as const, reason: "validation" as const, error: "Please enter whole square feet." };
  if (v?.pricingVersion && v.pricingVersion !== version)
    return {
      ok: false as const,
      reason: "validation" as const,
      error: "Pricing changed. Refresh your quote before paying.",
    };
  // Explicit allowlist: form/customer data is not a pricing input.
  return evaluateResidentialPrice(
    {
      bedrooms: v?.bedrooms,
      bathrooms: v?.bathrooms,
      sqft: v?.sqft,
      cleaningLevel: v?.cleaningLevel,
      petsAllowed: v?.petsAllowed,
      hotTub: v?.hotTub ?? "none",
      inUnitLaundryLoads: v?.inUnitLaundryLoads ?? 0,
    },
    version,
  );
}

/** Trusted persisted checkout version, never the currently active sale version. */
export function evaluateResidentialCheckout(
  input: unknown,
  version: string,
  configHash?: string,
  executionPolicy?: import("./residential-v2/execution-policy").V2ExecutionPolicy,
) {
  if (version !== "residential-v1" && version !== "residential-v2")
    throw new Error("Unsupported checkout pricing version");
  if (version === "residential-v2") {
    // Reader registry remains even when sale activation is disabled.
    if (configHash !== V2_CONFIG_HASH)
      throw new Error("Unsupported checkout configuration");
    const v = input as Record<string, unknown>;
    const result = evaluateResidentialPrice(
      {
        bedrooms: v.bedrooms,
        bathrooms: v.bathrooms,
        sqft: v.sqft,
        cleaningLevel: v.cleaningLevel,
        petsAllowed: v.petsAllowed,
        hotTub: v.hotTub,
        inUnitLaundryLoads: v.inUnitLaundryLoads,
      },
      version,
    );
    if (result.ok && result.terms.ruleVersion === "residential-v2")
      result.terms.executionPolicy = executionPolicy;
    return result;
  }
  const original = input as Record<string, unknown>;
  if (
    (original.hotTub !== undefined && original.hotTub !== "none") ||
    (original.inUnitLaundryLoads !== undefined &&
      original.inUnitLaundryLoads !== 0)
  )
    throw new Error("This checkout does not include the selected add-ons");
  return evaluateResidentialPrice(input, version);
}
