/**
 * Promo-code rules (task 1.8) — pure functions, no DB, no `server-only`, so the
 * math can be exercised by a standalone script exactly like the other
 * `lib/pricing` helpers.
 *
 * A promo code discounts the PREPAID FIRST CLEAN ONLY. It is applied last, on
 * whatever is left after the subscription-term discount (in the pricing
 * service) and the global first-clean discount (`first-clean-discount.ts`), so
 * the three never compound into a negative or double-count each other.
 */

/** Stripe rejects a USD PaymentIntent under 50 cents. */
export const MIN_CHARGE_CENTS = 50;

export type PromoDiscountType = "percent" | "fixed";

/** The subset of a `promo_codes` row the rules need. */
export type PromoCodeRules = {
  code: string;
  discountType: PromoDiscountType;
  /** Whole percent (1–100) for `percent`; CENTS for `fixed`. */
  discountValue: number;
  active: boolean;
  maxRedemptions: number | null;
  redemptionCount: number;
  startsAt: Date | null;
  expiresAt: Date | null;
};

export type PromoRejectionReason =
  | "not_found"
  | "inactive"
  | "not_started"
  | "expired"
  | "exhausted"
  | "amount_too_low";

export type PromoEvaluation =
  | {
      valid: true;
      code: string;
      discountCents: number;
      finalAmountCents: number;
      /** True when the discount was capped to keep the charge chargeable. */
      capped: boolean;
    }
  | { valid: false; reason: PromoRejectionReason; message: string };

/** Codes are stored and compared upper-cased and trimmed. */
export function normalizePromoCode(input: string): string {
  return input.trim().toUpperCase();
}

const REJECTION_MESSAGES: Record<PromoRejectionReason, string> = {
  not_found: "That promo code is not valid.",
  inactive: "That promo code is no longer active.",
  not_started: "That promo code is not active yet.",
  expired: "That promo code has expired.",
  exhausted: "That promo code has reached its redemption limit.",
  amount_too_low:
    "This booking is already below the minimum chargeable amount, so a promo code cannot be applied.",
};

function reject(reason: PromoRejectionReason): PromoEvaluation {
  return { valid: false, reason, message: REJECTION_MESSAGES[reason] };
}

/**
 * Raw discount the code is worth against `amountCents`, before any clamping.
 * Percent discounts round to the nearest cent.
 */
export function computePromoDiscountCents(
  amountCents: number,
  rules: Pick<PromoCodeRules, "discountType" | "discountValue">
): number {
  if (amountCents <= 0) return 0;

  if (rules.discountType === "percent") {
    const pct = Math.min(100, Math.max(0, rules.discountValue));
    return Math.round(amountCents * (pct / 100));
  }

  return Math.max(0, Math.round(rules.discountValue));
}

/**
 * Decide whether a code may be applied to `amountCents` and for how much.
 *
 * `now` is injected rather than read from the clock so the window checks are
 * testable. A discount large enough to take the charge below Stripe's 50-cent
 * floor is CAPPED, not rejected: the customer still gets the largest discount
 * we can actually charge, and `capped` says so, so the UI shows the real
 * number rather than the code's nominal value.
 */
export function evaluatePromoCode(
  amountCents: number,
  rules: PromoCodeRules | null,
  now: Date = new Date()
): PromoEvaluation {
  if (!rules) return reject("not_found");
  if (!rules.active) return reject("inactive");
  if (rules.startsAt && now < rules.startsAt) return reject("not_started");
  if (rules.expiresAt && now >= rules.expiresAt) return reject("expired");
  if (
    rules.maxRedemptions !== null &&
    rules.redemptionCount >= rules.maxRedemptions
  ) {
    return reject("exhausted");
  }
  if (amountCents <= MIN_CHARGE_CENTS) return reject("amount_too_low");

  const raw = computePromoDiscountCents(amountCents, rules);
  const maxDiscount = amountCents - MIN_CHARGE_CENTS;
  const discountCents = Math.min(raw, maxDiscount);

  return {
    valid: true,
    code: normalizePromoCode(rules.code),
    discountCents,
    finalAmountCents: amountCents - discountCents,
    capped: discountCents < raw,
  };
}

/** Human-readable value of a code, for admin tables and confirmation copy. */
export function formatPromoValue(
  rules: Pick<PromoCodeRules, "discountType" | "discountValue">
): string {
  return rules.discountType === "percent"
    ? `${rules.discountValue}% off`
    : `$${(rules.discountValue / 100).toFixed(2)} off`;
}
