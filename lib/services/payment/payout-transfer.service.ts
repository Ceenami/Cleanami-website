import "server-only";
import { assertFinanceCompatibility } from "./rental-credit";
import { db } from "@/db";
import { payouts, payoutTransferAttempts as attempts } from "@/db/schemas";
import { eq, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { assertMoneyRecoveryReady, payoutTransferRolloutAt, PROVIDER_RETRY_WINDOW_MS } from "./money-recovery-settings";

type Result = { outcome: "released" | "held" | "retry" | "skipped"; amount: number; error?: string };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function lockPayout(tx: Tx, id: string) {
  await tx.execute(sql`select id from payouts where id = ${id}::uuid for update`);
  return tx.query.payouts.findFirst({ where: eq(payouts.id, id), with: {
    cleaner: true, job: { with: { property: { with: { customer: true } }, subscription: { with: { customer: true } } } },
  } });
}

/** Persist the request before any transfer POST. The row lock orders dispatch
 * against admin/dispute holds. Keep it through the bounded provider call so a
 * hold committed before dispatch prevents dispatch and cannot be overwritten.
 */
export async function processPayoutTransfer(stripe: Stripe, payoutId: string): Promise<Result> {
  assertMoneyRecoveryReady();
  const cutoff = payoutTransferRolloutAt();
  const prepared = await db.transaction(async tx => {
    const payout = await lockPayout(tx, payoutId);
    if (!payout || payout.status !== "pending") return false;
    await assertFinanceCompatibility(payout.jobId, tx);
    const hold = async (error: string) => {
      await tx.update(payouts).set({ status: "held", processingStartedAt: null, updatedAt: new Date() }).where(eq(payouts.id, payoutId));
      return { outcome: "held", amount: 0, error } as Result;
    };
    const prior = await tx.query.payoutTransferAttempts.findFirst({ where: eq(attempts.payoutId, payoutId) });
    if (prior) return true;
    // Old workers cleared claims after unknown responses. A null claim is not
    // evidence of no transfer, so never automatically enroll legacy pending pay.
    if (payout.createdAt < cutoff || payout.processingStartedAt || payout.stripePayoutId) {
      return hold("Legacy payout needs Stripe reconciliation before dispatch");
    }
    if (payout.job?.property?.customer?.skipPayment || payout.job?.subscription?.customer?.skipPayment) {
      await tx.update(payouts).set({ status: "released", stripePayoutId: null, updatedAt: new Date() }).where(eq(payouts.id, payoutId));
      return { outcome: "released", amount: Number(payout.amount) } as Result;
    }
    const cents = Math.round(Number(payout.amount) * 100);
    if (!Number.isSafeInteger(cents) || cents < 100) return hold("Invalid payout amount (minimum $1.00)");
    if (!payout.cleaner?.stripeAccountId) return hold("Cleaner missing Stripe Connect account");
    await tx.insert(attempts).values({ payoutId, providerParams: {
      amount: cents, currency: "usd", destination: payout.cleaner.stripeAccountId,
      description: `CleanNami Job #${payout.jobId.slice(0, 8)}`,
      metadata: { payoutId, jobId: payout.jobId, cleanerId: payout.cleanerId },
    } });
    return true;
  });
  if (prepared !== true) return prepared || { outcome: "skipped", amount: 0 };

  return db.transaction(async tx => {
    const payout = await lockPayout(tx, payoutId);
    if (!payout || payout.status !== "pending") return { outcome: "skipped", amount: 0 };
    await assertFinanceCompatibility(payout.jobId, tx);
    const attempt = await tx.query.payoutTransferAttempts.findFirst({ where: eq(attempts.payoutId, payoutId) });
    if (!attempt) throw new Error("Missing durable transfer attempt");
    const hold = async (error: string) => {
      await tx.update(attempts).set({ state: "review", lastError: error }).where(eq(attempts.payoutId, payoutId));
      await tx.update(payouts).set({ status: "held", processingStartedAt: null, updatedAt: new Date() }).where(eq(payouts.id, payoutId));
      return { outcome: "held", amount: 0, error } as Result;
    };
    if (attempt.state === "review") return hold(attempt.lastError || "Transfer needs reconciliation");
    if (attempt.providerParams.amount !== Math.round(Number(payout.amount) * 100) ||
        attempt.providerParams.destination !== payout.cleaner?.stripeAccountId) {
      return hold("Payout amount or destination changed after transfer preparation");
    }
    if (!attempt.transferId && Date.now() - attempt.createdAt.getTime() >= PROVIDER_RETRY_WINDOW_MS) {
      return hold("Transfer outcome unknown beyond safe retry window; reconcile Stripe before any payment");
    }
    try {
      const transfer = attempt.transferId
        ? await stripe.transfers.retrieve(attempt.transferId, { timeout: 10_000, maxNetworkRetries: 0 })
        : await stripe.transfers.create(attempt.providerParams, {
          idempotencyKey: `payout_${payoutId}`, timeout: 10_000, maxNetworkRetries: 0,
        });
      const destination = typeof transfer.destination === "string" ? transfer.destination : transfer.destination?.id;
      if (transfer.amount !== attempt.providerParams.amount || transfer.currency !== "usd" ||
          destination !== attempt.providerParams.destination || transfer.metadata?.payoutId !== payoutId || transfer.reversed) {
        await tx.update(attempts).set({ transferId: transfer.id }).where(eq(attempts.payoutId, payoutId));
        return hold("Stripe transfer does not match prepared payout or was reversed");
      }
      await tx.update(attempts).set({ transferId: transfer.id, state: "succeeded", lastError: null }).where(eq(attempts.payoutId, payoutId));
      await tx.update(payouts).set({ stripePayoutId: transfer.id, status: "released", processingStartedAt: null, updatedAt: new Date() }).where(eq(payouts.id, payoutId));
      return { outcome: "released", amount: transfer.amount / 100 };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown transfer result";
      await tx.update(attempts).set({ state: "unknown", lastError: message }).where(eq(attempts.payoutId, payoutId));
      await tx.update(payouts).set({ processingStartedAt: null, updatedAt: new Date() }).where(eq(payouts.id, payoutId));
      return { outcome: "retry", amount: 0, error: message };
    }
  });
}
