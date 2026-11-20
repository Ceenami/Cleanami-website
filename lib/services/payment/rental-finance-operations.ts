import "server-only";
import { RentalFinanceError } from "./rental-finance-error";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { getStripe } from "@/lib/stripe/get-stripe";
import { verifySettledPayment } from "./verify-settled-payment";
import { PROVIDER_RETRY_WINDOW_MS } from "./money-recovery-settings";
import { recordFinancialPromo } from "./rental-finance-promo";
import { rows, json, financeNotice, type FinanceWriter } from "./rental-credit";

export type FinanceOperation = { id: string; identity: string; job_id: string | null; entitlement_id: string | null;
  kind: "clean_payment" | "late_fee" | "credit_refund" | "fee_refund"; cents: number;
  params: Stripe.PaymentIntentCreateParams & Stripe.RefundCreateParams; state: string; provider_id: string | null;
  token: string | null; claimed_at: string | null; last_error: string | null; actor: string; reason: string; created_at: string };
export async function operation(identity: string, writer: FinanceWriter = db) {
  return rows<FinanceOperation>(await writer.execute(sql`select * from rental_financial_operations where identity=${identity}`))[0] ?? null;
}
export async function prepareOperation(tx: FinanceWriter, input: { identity: string; jobId?: string; entitlementId?: string;
  kind: FinanceOperation["kind"]; cents: number; params: Stripe.PaymentIntentCreateParams | Stripe.RefundCreateParams; actor: string; reason: string }) {
  if (!Number.isSafeInteger(input.cents) || input.cents < 1) throw new RentalFinanceError("Financial amounts must be positive integer cents");
  const id = randomUUID();
  const params = { ...input.params, metadata: { ...input.params.metadata, rental_financial_operation_id: id } };
  await tx.execute(sql`insert into rental_financial_operations(id,identity,job_id,entitlement_id,kind,cents,params,actor,reason)
    values(${id}::uuid,${input.identity},${input.jobId ?? null}::uuid,${input.entitlementId ?? null}::uuid,${input.kind},${input.cents},${json(params)},${input.actor},${input.reason}) on conflict(identity) do nothing`);
  const saved = (await operation(input.identity, tx))!;
  if (saved.cents !== input.cents || saved.kind !== input.kind || saved.job_id !== (input.jobId ?? null) || saved.entitlement_id !== (input.entitlementId ?? null))
    throw new RentalFinanceError("Financial operation terms changed; reconcile the existing operation");
  return saved;
}

/** Durable request first; short fenced lease; no provider work inside a DB
 * transaction. Unknown attempts reuse the same key only inside the safe window. */
export async function runOperation(identity: string, suppliedStripe?: Stripe) {
  const stripe = suppliedStripe ?? getStripe();
  if (!stripe) throw new RentalFinanceError("Payment provider unavailable; obligation remains pending");
  const claimed = await db.transaction(async tx => {
    const [op] = rows<FinanceOperation>(await tx.execute(sql`select * from rental_financial_operations where identity=${identity} for update`));
    if (!op) throw new RentalFinanceError("Financial operation not found");
    if (["waived", "refunded", "review"].includes(op.state)) return { op, token: null };
    if (!op.kind.endsWith("refund") && op.cents < 50 && !op.provider_id) {
      await tx.execute(sql`update rental_financial_operations set state='review',last_error='Balance is below the provider minimum; explicit management waiver/review is required' where id=${op.id}::uuid`);
      return { op: { ...op, state: "review" }, token: null };
    }
    if (op.state === "submitting" && op.claimed_at && Date.now() - +new Date(op.claimed_at) < 60_000)
      throw new RentalFinanceError("Financial operation is running. Retry after one minute.");
    if (!op.provider_id && Date.now() - +new Date(op.created_at) >= PROVIDER_RETRY_WINDOW_MS) {
      await tx.execute(sql`update rental_financial_operations set state='review',last_error='Uncertain provider request passed its safe retry window' where id=${op.id}::uuid`);
      return { op: { ...op, state: "review" }, token: null };
    }
    const token = randomUUID();
    await tx.execute(sql`update rental_financial_operations set state='submitting',token=${token}::uuid,claimed_at=clock_timestamp() where id=${op.id}::uuid`);
    return { op, token };
  });
  if (!claimed.token) return claimed.op;
  const { op, token } = claimed;
  let providerId = op.provider_id, state = "unknown", lastError: string | null = null;
  try {
    const opts = { idempotencyKey: `rental-finance:${op.id}`, timeout: 10_000, maxNetworkRetries: 0 };
    if (op.kind.endsWith("refund")) {
      const refund = providerId ? await stripe.refunds.retrieve(providerId, {}, { timeout: 10_000, maxNetworkRetries: 0 }) : await stripe.refunds.create(op.params, opts);
      if (refund.amount !== op.cents || refund.currency !== "usd" || refund.metadata?.rental_financial_operation_id !== op.id ||
          (typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id) !== op.params.payment_intent)
        throw new RentalFinanceError("Refund result does not match immutable request");
      providerId = refund.id;
      state = refund.status === "succeeded" ? "paid" : refund.status === "failed" || refund.status === "canceled" ? "failed" : "processing";
    } else {
      const pi = providerId ? await stripe.paymentIntents.retrieve(providerId, {}, { timeout: 10_000, maxNetworkRetries: 0 }) : await stripe.paymentIntents.create(op.params, opts);
      const customer = typeof pi.customer === "string" ? pi.customer : pi.customer?.id;
      if (pi.metadata?.rental_financial_operation_id !== op.id || pi.amount !== op.cents || pi.currency !== "usd" || customer !== op.params.customer)
        throw new RentalFinanceError("Payment result does not match immutable request");
      providerId = pi.id;
      if (pi.status === "succeeded") { await verifySettledPayment(stripe, pi, op.cents); state = "paid"; }
      else if (pi.status === "requires_action" || pi.status === "requires_confirmation" || (pi.status === "requires_payment_method" && !pi.last_payment_error)) state = "requires_action";
      else if (pi.status === "processing") state = "processing";
      else state = "failed";
    }
  } catch (error) {
    // Card errors can contain an already-created PI. Bind only after validating
    // its immutable operation metadata, amount and customer on a later read.
    const candidate = (error as { payment_intent?: Stripe.PaymentIntent }).payment_intent;
    if (candidate?.metadata?.rental_financial_operation_id === op.id && candidate.amount === op.cents &&
        candidate.currency === "usd" && candidate.customer === op.params.customer) providerId = candidate.id;
    lastError = "Provider outcome requires reconciliation; do not create a new payment";
  }
  const saved = await db.transaction(async tx => {
    const [current] = rows<FinanceOperation>(await tx.execute(sql`select * from rental_financial_operations where id=${op.id}::uuid for update`));
    if (current.token !== token) throw new RentalFinanceError("A newer reconciliation owns this operation");
    const [saved] = rows<FinanceOperation>(await tx.execute(sql`update rental_financial_operations set state=${state},provider_id=${providerId},last_error=${lastError}
      where id=${op.id}::uuid and token=${token}::uuid returning *`));
    if (saved.job_id) {
      const [f] = rows<{ customer_id: string }>(await tx.execute(sql`select customer_id from rental_job_finances where job_id=${saved.job_id}::uuid`));
      if (f) await financeNotice(tx, `${saved.id}:${state}`, f.customer_id, saved.job_id,
        saved.kind === "late_fee" ? "Late-cancellation payment update" : "CleanNami payment update",
        [`${saved.kind.replaceAll("_", " ")}: $${(saved.cents / 100).toFixed(2)}.`, `Payment status: ${state.replaceAll("_", " ")}.`,
          "Your first-clean prepaid balance is separate from any late-cancellation fee."]);
    }
    return saved;
  });
  if (saved.kind === "late_fee" && saved.state === "paid" && saved.job_id) await recordFinancialPromo(saved.job_id);
  return saved;
}
