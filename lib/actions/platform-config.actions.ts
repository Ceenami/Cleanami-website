"use server";

import { getAdminAuth } from "@/lib/admin-auth";
import { setFirstCleanDiscountPercent } from "@/lib/pricing/first-clean-discount";

/** Admin sets the global first-clean discount percent (task 1.9). */
export async function updateFirstCleanDiscount(
  percent: number
): Promise<{ success: boolean; error?: string }> {
  const { isAdmin } = await getAdminAuth();
  if (!isAdmin) return { success: false, error: "Unauthorized" };
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return { success: false, error: "Enter a value between 0 and 100." };
  }
  await setFirstCleanDiscountPercent(percent);
  return { success: true };
}
