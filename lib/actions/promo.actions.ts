"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAdminAuth } from "@/lib/admin-auth";
import {
  createPromoCode,
  deletePromoCode,
  setPromoCodeActive,
} from "@/lib/services/promo-code.service";

type ActionResult = { success: boolean; error?: string };

const createSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(3, "Use at least 3 characters.")
      .max(64)
      .regex(
        /^[A-Za-z0-9_-]+$/,
        "Use letters, numbers, hyphens and underscores only."
      ),
    description: z.string().trim().max(200).optional(),
    discountType: z.enum(["percent", "fixed"]),
    /** Percent 1–100, or dollars for a fixed code (converted to cents below). */
    discountValue: z.number().positive("Enter a discount greater than zero."),
    maxRedemptions: z.number().int().positive().nullable().optional(),
    startsAt: z.string().trim().optional(),
    expiresAt: z.string().trim().optional(),
  })
  .refine(
    (data) => data.discountType !== "percent" || data.discountValue <= 100,
    { message: "A percentage discount cannot exceed 100.", path: ["discountValue"] }
  );

export type CreatePromoCodeFormInput = z.input<typeof createSchema>;

function parseDate(value?: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function createPromoCodeAction(
  input: CreatePromoCodeFormInput
): Promise<ActionResult> {
  const { isAdmin } = await getAdminAuth();
  if (!isAdmin) return { success: false, error: "Unauthorized" };

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const data = parsed.data;
  const startsAt = parseDate(data.startsAt);
  const expiresAt = parseDate(data.expiresAt);

  if (startsAt && expiresAt && expiresAt <= startsAt) {
    return { success: false, error: "The end date must be after the start date." };
  }

  const result = await createPromoCode({
    code: data.code,
    description: data.description,
    discountType: data.discountType,
    // Percent codes store whole percents; fixed codes are entered in dollars
    // and stored in cents, because money is integer cents everywhere else.
    discountValue:
      data.discountType === "percent"
        ? Math.round(data.discountValue)
        : Math.round(data.discountValue * 100),
    maxRedemptions: data.maxRedemptions ?? null,
    startsAt,
    expiresAt,
  });

  if (result.success) revalidatePath("/admin/promo-codes");
  return result;
}

export async function setPromoCodeActiveAction(
  id: string,
  active: boolean
): Promise<ActionResult> {
  const { isAdmin } = await getAdminAuth();
  if (!isAdmin) return { success: false, error: "Unauthorized" };

  if (!z.uuid().safeParse(id).success) {
    return { success: false, error: "Invalid promo code." };
  }

  await setPromoCodeActive(id, active);
  revalidatePath("/admin/promo-codes");
  return { success: true };
}

export async function deletePromoCodeAction(id: string): Promise<ActionResult> {
  const { isAdmin } = await getAdminAuth();
  if (!isAdmin) return { success: false, error: "Unauthorized" };

  if (!z.uuid().safeParse(id).success) {
    return { success: false, error: "Invalid promo code." };
  }

  const result = await deletePromoCode(id);
  if (result.success) revalidatePath("/admin/promo-codes");
  return result;
}
