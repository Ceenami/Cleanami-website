import "server-only";
import type Stripe from "stripe";

const objectId = (value: string | { id: string } | null) => typeof value === "string" ? value : value?.id;

/** Provider truth, including pending and prior partial refunds. Never infer a
 * full refund from a succeeded PaymentIntent or charge.amount_refunded alone. */
export async function inspectBookingReversal(stripe: Stripe, paymentIntentId: string, expectedCents?: number) {
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (intent.id !== paymentIntentId || intent.currency !== "usd" ||
      !Number.isSafeInteger(intent.amount) || intent.amount <= 0 ||
      (expectedCents !== undefined && intent.amount !== expectedCents))
    throw new Error("Payment identity or amount requires reconciliation");
  if (intent.status === "canceled") {
    if (intent.amount_received !== 0) throw new Error("Canceled payment still reports collected funds");
    return { intent, refunds: [], refundedCents: 0, pendingCents: 0, remainingCents: 0 };
  }
  if (intent.status !== "succeeded") {
    if (intent.amount_received !== 0 || !["requires_capture", "requires_payment_method", "requires_confirmation", "requires_action"].includes(intent.status))
      throw new Error("Payment is processing; reconcile before reversal");
    return { intent, refunds: [], refundedCents: 0, pendingCents: 0, remainingCents: 0 };
  }
  const charge = typeof intent.latest_charge === "string" ? await stripe.charges.retrieve(intent.latest_charge) : intent.latest_charge;
  if (!charge || !charge.paid || !charge.captured || charge.currency !== "usd" || charge.amount !== intent.amount ||
      objectId(charge.payment_intent) !== intent.id || intent.amount_received !== intent.amount)
    throw new Error("Collected payment requires reconciliation");
  const refunds: Stripe.Refund[] = [], seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; ; page++) {
    if (page >= 100) throw new Error("Refund history exceeds reconciliation limit");
    const result = await stripe.refunds.list({ payment_intent: intent.id, limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
    for (const refund of result.data) {
      if (seen.has(refund.id) || objectId(refund.payment_intent) !== intent.id || objectId(refund.charge) !== charge.id ||
          refund.currency !== "usd" || !Number.isSafeInteger(refund.amount) || refund.amount <= 0)
        throw new Error("Refund history is inconsistent");
      seen.add(refund.id); refunds.push(refund);
    }
    if (!result.has_more) break;
    const last = result.data.at(-1)?.id;
    if (!last || last === cursor) throw new Error("Incomplete refund history");
    cursor = last;
  }
  const refundedCents = refunds.filter(r => r.status === "succeeded").reduce((sum, r) => sum + r.amount, 0);
  // Unknown statuses block a new request, rather than being treated as failures.
  const pendingCents = refunds.filter(r => !["succeeded", "failed", "canceled"].includes(r.status ?? "")).reduce((sum, r) => sum + r.amount, 0);
  if (refundedCents + pendingCents > intent.amount_received) throw new Error("Refund totals exceed collected payment");
  return { intent, refunds, refundedCents, pendingCents, remainingCents: intent.amount_received - refundedCents };
}

/** The caller persists attemptId/amount BEFORE provider work and retains them
 * after timeouts. A new key is only permitted after a known terminal failure. */
export async function requestBookingReversal(stripe: Stripe, input: {
  paymentIntentId: string; jobId: string; attemptId: string; amountCents: number; captured: boolean;
}) {
  const options = { idempotencyKey: `condition-rejection:${input.attemptId}` };
  if (input.captured) {
    return stripe.refunds.create({ payment_intent: input.paymentIntentId, amount: input.amountCents,
      metadata: { job_id: input.jobId, condition_refund_attempt: input.attemptId } }, options);
  }
  await stripe.paymentIntents.cancel(input.paymentIntentId, {}, options);
  return null;
}
