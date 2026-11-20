import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { payouts } from "@/db/schemas";
import { eq } from "drizzle-orm";
import { getStripe } from "@/lib/stripe/get-stripe";
import { assertCronAuth } from "@/lib/auth/cron-auth";
import { assertMoneyRecoveryReady, payoutTransferRolloutAt } from "@/lib/services/payment/money-recovery-settings";
import { processPayoutTransfer } from "@/lib/services/payment/payout-transfer.service";

export async function POST(req: NextRequest) {
  const unauthorized = assertCronAuth(req);
  if (unauthorized) return unauthorized;
  try {
    assertMoneyRecoveryReady();
    payoutTransferRolloutAt();
    const stripe = getStripe();
    if (!stripe) return NextResponse.json({ error: "Payments unavailable" }, { status: 503 });
    const pending = await db.query.payouts.findMany({ where: eq(payouts.status, "pending"), columns: { id: true, cleanerId: true } });
    let processed = 0, held = 0, failed = 0, total = 0;
    const errors: Array<{ payoutId: string; cleanerId: string; error: string }> = [];
    for (const payout of pending) {
      try {
        const result = await processPayoutTransfer(stripe, payout.id);
        if (result.outcome === "released") { processed++; total += result.amount; }
        if (result.outcome === "held") held++;
        if (result.outcome === "retry") failed++;
        if (result.error) errors.push({ payoutId: payout.id, cleanerId: payout.cleanerId, error: result.error });
      } catch (error) {
        failed++;
        errors.push({ payoutId: payout.id, cleanerId: payout.cleanerId, error: error instanceof Error ? error.message : "Transfer needs review" });
      }
    }
    return NextResponse.json({ success: true, message: "Payout processing complete", totalPendingFound: pending.length,
      processed, failed, held, totalPaidOutUSD: total.toFixed(2), errors: errors.length ? errors : undefined });
  } catch (error) {
    console.error("Payout processing unavailable", error);
    return NextResponse.json({ error: "Payout processing unavailable; review configuration and recovery schema" }, { status: 503 });
  }
}
