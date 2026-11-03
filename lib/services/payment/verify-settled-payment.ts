import "server-only";
import type Stripe from "stripe";

/** Provider success alone survives refunds. Verify money before issuing/payroll. */
export async function verifySettledPayment(
  stripe: Stripe,
  intent: Stripe.PaymentIntent,
  expectedCents: number = intent.amount,
) {
  if (
    intent.status !== "succeeded" || intent.currency !== "usd" ||
    !Number.isSafeInteger(expectedCents) || expectedCents <= 0 ||
    intent.amount !== expectedCents || intent.amount_received !== expectedCents
  ) throw new Error("Payment amount, currency or settlement requires review. Contact CleanNami before paying again.");
  const charge = typeof intent.latest_charge === "string"
    ? await stripe.charges.retrieve(intent.latest_charge)
    : intent.latest_charge;
  if (!charge || charge.currency !== "usd" || charge.amount !== expectedCents ||
      charge.amount_refunded !== 0 || charge.refunded || !charge.paid || !charge.captured)
    throw new Error("Missing, refunded or mismatched charge requires review. No new booking or payout was created.");
  const refunds = await stripe.refunds.list({ payment_intent: intent.id, limit: 100 });
  if (refunds.has_more || refunds.data.some(r => r.status !== "failed" && r.status !== "canceled"))
    throw new Error("This payment has entered refund processing. Contact CleanNami before booking again.");
}
