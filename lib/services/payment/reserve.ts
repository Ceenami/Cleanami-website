import "server-only";

import { db } from "@/db";
import { reserveTransactions, stripeDisputes } from "@/db/schemas";
import { count, gte } from "drizzle-orm";

/** Spec §5/§20 reserve policy. */
export const BASE_RESERVE_RATE = 0.02;
export const ESCALATED_RESERVE_RATE = 0.05;
/** Escalate once the rolling 30-day dispute rate exceeds 0.5%. */
export const DISPUTE_RATE_THRESHOLD = 0.005;
const WINDOW_DAYS = 30;

/**
 * Current platform reserve rate. Holds the base 2%, escalating to 5% when the
 * dispute rate over the last 30 days (disputes ÷ captured payments) exceeds
 * 0.5%. Captures are counted from `reserve_transactions` (one row per capture),
 * disputes from `stripe_disputes`.
 */
export async function computeReserveRate(now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [captureRows, disputeRows] = await Promise.all([
    db
      .select({ c: count() })
      .from(reserveTransactions)
      .where(gte(reserveTransactions.createdAt, since)),
    db
      .select({ c: count() })
      .from(stripeDisputes)
      .where(gte(stripeDisputes.createdAt, since)),
  ]);

  const captures = Number(captureRows[0]?.c ?? 0);
  const disputes = Number(disputeRows[0]?.c ?? 0);

  if (captures === 0) return BASE_RESERVE_RATE;
  return disputes / captures > DISPUTE_RATE_THRESHOLD
    ? ESCALATED_RESERVE_RATE
    : BASE_RESERVE_RATE;
}
