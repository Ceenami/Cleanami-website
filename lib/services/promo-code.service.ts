import "server-only";

import { db } from "@/db";
import { promoCodes, promoRedemptions } from "@/db/schemas";
import { desc, eq, sql } from "drizzle-orm";
import {
  evaluatePromoCode,
  normalizePromoCode,
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

/**
 * Look a code up and decide whether it applies to `amountCents`.
 *
 * Returns the evaluation plus the row id when valid, so the caller can record
 * the redemption later without a second lookup. Never throws for an unknown
 * code — an unknown code is an ordinary "not valid" answer.
 */
export async function resolvePromoCodeForAmount(
  rawCode: string,
  amountCents: number
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

  const rules: PromoCodeRules | null = row
    ? {
        code: row.code,
        discountType: row.discountType,
        discountValue: row.discountValue,
        active: row.active,
        maxRedemptions: row.maxRedemptions,
        redemptionCount: row.redemptionCount,
        startsAt: row.startsAt,
        expiresAt: row.expiresAt,
      }
    : null;

  return {
    evaluation: evaluatePromoCode(amountCents, rules),
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
