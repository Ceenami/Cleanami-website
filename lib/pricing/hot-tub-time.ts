import "server-only";

import { db } from "@/db";
import {
  DEFAULT_HOT_TUB_TIME_ADDITIONS,
  type HotTubTimeAdditions,
} from "@/lib/pricing/staffing-logic";

/**
 * Load the configured hot-tub time additions from `hot_tub_pricing_rules`.
 *
 * These are client-editable through the admin pricing upload, so the staffing
 * calculation must read them rather than hardcode hours. Any row that is
 * missing or unparseable falls back to the spec default for that service type,
 * so a partial rules table degrades to correct behaviour instead of zero hours.
 *
 * Load once per batch and pass the result down — this hits the database.
 */
export async function loadHotTubTimeAdditions(): Promise<HotTubTimeAdditions> {
  try {
    const rules = await db.query.hotTubPricingRules.findMany();
    return {
      basicHours: readHours(rules, "Basic", DEFAULT_HOT_TUB_TIME_ADDITIONS.basicHours),
      deepCleanHours: readHours(
        rules,
        "Full_Drain",
        DEFAULT_HOT_TUB_TIME_ADDITIONS.deepCleanHours
      ),
    };
  } catch (error) {
    console.error("[hot-tub-time] failed to load rules, using defaults", error);
    return DEFAULT_HOT_TUB_TIME_ADDITIONS;
  }
}

/** `timeAddHours` is a Postgres decimal, so Drizzle hands it back as a string. */
function readHours(
  rules: Array<{ serviceType: string; timeAddHours: string | number }>,
  serviceType: string,
  fallback: number
): number {
  const rule = rules.find((r) => r.serviceType === serviceType);
  if (!rule) return fallback;

  const hours = Number(rule.timeAddHours);
  return Number.isFinite(hours) && hours >= 0 ? hours : fallback;
}
