/**
 * Laundry loads are a *required* input whenever a property has laundry service,
 * because they are a direct multiplier on what the customer is charged
 * (`pricing_data/laundry_pricing.csv`: In-Unit $0 base + $9/load, Off-Site $20
 * base + $9/load). A blank count used to price laundry at $0 and — for off-site
 * — lose the $20 base fee too, so the whole add-on billed as free.
 *
 * No server-only imports: the two admin property forms, three zod schemas and
 * the query layer all share these, and duplicating the rule per surface is how
 * it drifted in the first place.
 */

export type LaundryTypeValue = "in_unit" | "off_site" | "none";

/** Customer-facing wording, kept identical across every surface that rejects. */
export const LAUNDRY_LOADS_REQUIRED_MESSAGE =
  "Enter how many loads per turnover (at least 1), or choose no laundry service.";

/**
 * Only `in_unit` / `off_site` bill per load. `none` must carry no count at all —
 * see `normalizeLaundryLoads`.
 */
export function requiresLaundryLoads(
  laundryType: string | null | undefined
): boolean {
  return laundryType === "in_unit" || laundryType === "off_site";
}

/** A usable count is a whole number of at least one. `0` is the same bug as blank. */
export function isValidLaundryLoads(loads: unknown): boolean {
  const n = Number(loads);
  return Number.isInteger(n) && n >= 1;
}

/**
 * True when this pairing would silently under-bill. Deliberately takes the
 * *merged* pair rather than a patch, because a partial update that changes only
 * `laundryType` is exactly the case a per-field check cannot see.
 */
export function laundryLoadsMissing(input: {
  laundryType: string | null | undefined;
  laundryLoads: number | null | undefined;
}): boolean {
  return (
    requiresLaundryLoads(input.laundryType) &&
    !isValidLaundryLoads(input.laundryLoads)
  );
}

/**
 * Throws `LAUNDRY_LOADS_REQUIRED_MESSAGE` when the pair is unbillable. Used at
 * the query layer, which is the last point that sees the post-patch state.
 */
export function assertLaundryLoads(input: {
  laundryType: string | null | undefined;
  laundryLoads: number | null | undefined;
}): void {
  if (laundryLoadsMissing(input)) {
    throw new Error(LAUNDRY_LOADS_REQUIRED_MESSAGE);
  }
}

/**
 * A property with no laundry service must store `null`, never a stale count —
 * otherwise switching the type back to `in_unit` silently resurrects an old
 * number the customer never re-confirmed.
 */
export function normalizeLaundryLoads(
  laundryType: string | null | undefined,
  laundryLoads: number | null | undefined
): number | null {
  if (!requiresLaundryLoads(laundryType)) return null;
  return laundryLoads ?? null;
}
