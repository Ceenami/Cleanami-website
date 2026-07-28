import "server-only";

import { db } from "@/db";
import { promoCodes, promoRedemptions } from "@/db/schemas";
import { and, desc, eq, sql } from "drizzle-orm";
import { isUniqueViolation } from "@/lib/db/errors";
import {
  evaluatePromoCode,
  normalizePromoCode,
  REJECTION_MESSAGES,
  type PromoEvaluation,
  type PromoCodeRules,
} from "@/lib/pricing/promo-code";

export type ResolvedPromo = {
  promoCodeId: string;
  code: string;
  discountCents: number;
  finalAmountCents: number;
  capped: boolean;
};

type PromoCodeRow = {
  id: string;
  code: string;
  discountType: PromoCodeRules["discountType"];
  discountValue: number;
  active: boolean;
  maxRedemptions: number | null;
  redemptionCount: number;
  startsAt: Date | null;
  expiresAt: Date | null;
};

/**
 * Has this customer ever redeemed this code before? Keyed on email (not
 * customer id) because at checkout-preview time, before an account exists,
 * there is no customer id yet — email is the only identity we always have.
 * Mirrors the case-insensitive comparison the pre-existing
 * `promo_redemptions_email_idx` was built for.
 */
export async function hasCustomerRedeemedPromoCode(
  promoCodeId: string,
  email: string
): Promise<boolean> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return false;

  const existing = await db.query.promoRedemptions.findFirst({
    where: and(
      eq(promoRedemptions.promoCodeId, promoCodeId),
      sql`lower(${promoRedemptions.customerEmail}) = ${normalizedEmail}`
    ),
    columns: { id: true },
  });

  return !!existing;
}

async function evaluateRow(
  row: PromoCodeRow | undefined,
  amountCents: number,
  customerEmail: string
): Promise<PromoEvaluation> {
  if (!row) return evaluatePromoCode(amountCents, null);

  // Checked before the rest of the rules so a customer re-trying a code they
  // already burned gets a clear answer rather than a generic rejection.
  if (await hasCustomerRedeemedPromoCode(row.id, customerEmail)) {
    return {
      valid: false,
      reason: "already_used",
      message: REJECTION_MESSAGES.already_used,
    };
  }

  const rules: PromoCodeRules = {
    code: row.code,
    discountType: row.discountType,
    discountValue: row.discountValue,
    active: row.active,
    maxRedemptions: row.maxRedemptions,
    redemptionCount: row.redemptionCount,
    startsAt: row.startsAt,
    expiresAt: row.expiresAt,
  };

  return evaluatePromoCode(amountCents, rules);
}

/**
 * Look a code up and decide whether it applies to `amountCents`.
 *
 * Returns the evaluation plus the row id when valid, so the caller can record
 * the redemption later without a second lookup. Never throws for an unknown
 * code — an unknown code is an ordinary "not valid" answer.
 *
 * `customerEmail` may be empty at the very start of the booking-checkout
 * preview (before the customer has typed it in) — the already-used check is
 * simply skipped in that case; the authoritative re-check before charging
 * always has an email by then.
 */
export async function resolvePromoCodeForAmount(
  rawCode: string,
  amountCents: number,
  customerEmail: string
): Promise<{ evaluation: PromoEvaluation; promoCodeId: string | null }> {
  const code = normalizePromoCode(rawCode);
  if (!code) {
    return {
      evaluation: evaluatePromoCode(amountCents, null),
      promoCodeId: null,
    };
  }

  const row = await db.query.promoCodes.findFirst({
    where: eq(promoCodes.code, code),
  });

  return {
    evaluation: await evaluateRow(row, amountCents, customerEmail),
    promoCodeId: row?.id ?? null,
  };
}

/**
 * Same as `resolvePromoCodeForAmount`, but looked up by the code's row id
 * rather than its text — used where only a stored `promo_code_id` is on hand
 * (a job's applied code), not the raw code string.
 */
export async function resolvePromoCodeById(
  promoCodeId: string,
  amountCents: number,
  customerEmail: string
): Promise<{ evaluation: PromoEvaluation; promoCodeId: string | null }> {
  const row = await db.query.promoCodes.findFirst({
    where: eq(promoCodes.id, promoCodeId),
  });

  return {
    evaluation: await evaluateRow(row, amountCents, customerEmail),
    promoCodeId: row?.id ?? null,
  };
}

/**
 * Record a code as used against a completed booking and bump its counter.
 *
 * Idempotent on `paymentIntentId`: onboarding completion can legitimately run
 * twice for the same PaymentIntent (retry, double submit), and the second run
 * must not burn a second redemption. Best-effort by design — the booking has
 * already been paid for by the time this runs, so a bookkeeping failure here
 * is logged, never thrown back into the onboarding path.
 */
export async function recordPromoRedemption(input: {
  promoCodeId: string;
  code: string;
  customerEmail: string;
  customerId?: string | null;
  subscriptionId?: string | null;
  /** The recurring clean this redemption discounted; omitted for a first-clean redemption. */
  jobId?: string | null;
  paymentIntentId: string;
  originalAmountCents: number;
  discountAmountCents: number;
  finalAmountCents: number;
}): Promise<{ recorded: boolean }> {
  try {
    const inserted = await db
      .insert(promoRedemptions)
      .values({
        promoCodeId: input.promoCodeId,
        code: normalizePromoCode(input.code),
        customerEmail: input.customerEmail,
        customerId: input.customerId ?? null,
        subscriptionId: input.subscriptionId ?? null,
        jobId: input.jobId ?? null,
        paymentIntentId: input.paymentIntentId,
        originalAmountCents: input.originalAmountCents,
        discountAmountCents: input.discountAmountCents,
        finalAmountCents: input.finalAmountCents,
      })
      .onConflictDoNothing({ target: promoRedemptions.paymentIntentId })
      .returning({ id: promoRedemptions.id });

    // No row back = this PaymentIntent was already recorded; do not re-count.
    if (inserted.length === 0) return { recorded: false };

    await db
      .update(promoCodes)
      .set({
        redemptionCount: sql`${promoCodes.redemptionCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(promoCodes.id, input.promoCodeId));

    return { recorded: true };
  } catch (error) {
    // Postgres unique_violation on promo_redemptions_code_customer_once_idx:
    // a concurrent redemption of the same code by the same customer beat
    // this one to the write (the once-per-customer-ever backstop firing).
    // Charge already happened by this point either way — log distinctly from
    // a generic DB error so this specific race is visible if it ever occurs.
    if (isUniqueViolation(error)) {
      console.warn(
        `[promo] ${input.code} already redeemed by ${input.customerEmail} (concurrent redemption); PI ${input.paymentIntentId} not recorded`
      );
      return { recorded: false };
    }
    console.error(
      `[promo] failed to record redemption of ${input.code} for ${input.paymentIntentId}`,
      error
    );
    return { recorded: false };
  }
}

/**
 * Record a redemption when all we carry forward is the code text (it travels on
 * the PaymentIntent metadata). Resolves the row, then defers to
 * `recordPromoRedemption` for the idempotent write.
 */
export async function recordPromoRedemptionByCode(input: {
  code: string;
  customerEmail: string;
  customerId?: string | null;
  subscriptionId?: string | null;
  jobId?: string | null;
  paymentIntentId: string;
  originalAmountCents: number;
  discountAmountCents: number;
  finalAmountCents: number;
}): Promise<{ recorded: boolean }> {
  const code = normalizePromoCode(input.code);
  if (!code) return { recorded: false };

  const row = await db.query.promoCodes.findFirst({
    where: eq(promoCodes.code, code),
    columns: { id: true },
  });

  if (!row) {
    // The code was deleted between checkout and completion. The charge already
    // reflects the discount, so this is bookkeeping loss, not a money error.
    console.warn(
      `[promo] ${code} no longer exists; redemption for ${input.paymentIntentId} not recorded`
    );
    return { recorded: false };
  }

  return recordPromoRedemption({ ...input, promoCodeId: row.id, code });
}

export type PromoCodeListRow = {
  id: string;
  code: string;
  description: string | null;
  discountType: "percent" | "fixed";
  discountValue: number;
  active: boolean;
  maxRedemptions: number | null;
  redemptionCount: number;
  startsAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
};

/** Admin list, newest first. */
export async function listPromoCodes(): Promise<PromoCodeListRow[]> {
  return db.query.promoCodes.findMany({
    orderBy: desc(promoCodes.createdAt),
  });
}

export type CreatePromoCodeInput = {
  code: string;
  description?: string | null;
  discountType: "percent" | "fixed";
  /** Whole percent for `percent`; CENTS for `fixed`. */
  discountValue: number;
  maxRedemptions?: number | null;
  startsAt?: Date | null;
  expiresAt?: Date | null;
};

export async function createPromoCode(
  input: CreatePromoCodeInput
): Promise<{ success: boolean; error?: string }> {
  const code = normalizePromoCode(input.code);

  const existing = await db.query.promoCodes.findFirst({
    where: eq(promoCodes.code, code),
    columns: { id: true },
  });
  if (existing) {
    return { success: false, error: `${code} already exists.` };
  }

  await db.insert(promoCodes).values({
    code,
    description: input.description?.trim() || null,
    discountType: input.discountType,
    discountValue: input.discountValue,
    maxRedemptions: input.maxRedemptions ?? null,
    startsAt: input.startsAt ?? null,
    expiresAt: input.expiresAt ?? null,
  });

  return { success: true };
}

export async function setPromoCodeActive(
  id: string,
  active: boolean
): Promise<void> {
  await db
    .update(promoCodes)
    .set({ active, updatedAt: new Date() })
    .where(eq(promoCodes.id, id));
}

/**
 * Delete a code. Redemption rows cascade with it, so a code that has been used
 * is deactivated instead — the money history has to survive.
 */
export async function deletePromoCode(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const row = await db.query.promoCodes.findFirst({
    where: eq(promoCodes.id, id),
    columns: { redemptionCount: true },
  });

  if (!row) return { success: false, error: "Promo code not found." };

  if (row.redemptionCount > 0) {
    return {
      success: false,
      error:
        "This code has been redeemed and cannot be deleted. Deactivate it instead.",
    };
  }

  await db.delete(promoCodes).where(eq(promoCodes.id, id));
  return { success: true };
}
