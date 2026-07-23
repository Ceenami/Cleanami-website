import "server-only";

import { db } from "@/db";
import { platformConfig } from "@/db/schemas";
import { eq } from "drizzle-orm";

const KEY = "first_clean_discount_percent";

/** Admin-set first-clean discount as a whole percent (0–100); 0 when unset. */
export async function getFirstCleanDiscountPercent(): Promise<number> {
  const row = await db.query.platformConfig.findFirst({
    where: eq(platformConfig.key, KEY),
    columns: { intValue: true },
  });
  const pct = row?.intValue ?? 0;
  return Math.min(100, Math.max(0, pct));
}

/** Persist the first-clean discount percent (clamped 0–100). */
export async function setFirstCleanDiscountPercent(pct: number): Promise<void> {
  const clamped = Math.min(100, Math.max(0, Math.round(pct)));
  await db
    .insert(platformConfig)
    .values({ key: KEY, intValue: clamped })
    .onConflictDoUpdate({
      target: platformConfig.key,
      set: { intValue: clamped, updatedAt: new Date() },
    });
}

/** Apply the first-clean discount to an amount in cents. */
export function applyFirstCleanDiscount(
  amountCents: number,
  percent: number
): number {
  if (percent <= 0) return amountCents;
  return Math.round(amountCents * (1 - percent / 100));
}
