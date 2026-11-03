import "server-only";

import { getStripe } from "@/lib/stripe/get-stripe";
import { isSkippedPaymentIntent } from "@/lib/billing/customer-billing";

/**
 * Undo a customer charge — cancel it if it is still an authorization, refund it
 * if it has already been captured.
 *
 * Extracted from `customer-cancellation.service.ts`, which owned the only copy,
 * so the one-off booking path can compensate a charge whose job row failed to
 * save. These remain the only two Stripe refund/cancel call sites in the repo;
 * a third by copy-paste is how the skip-payment and authorized/captured
 * handling drift apart.
 *
 * Recovery callers are best-effort by default so a void failure cannot mask
 * their original error. Cancellation opts into strict handling: its database
 * transaction must not record a refund the provider did not accept.
 */
export async function voidCharge(input: {
  paymentIntentId: string | null;
  /** `"authorized"` cancels, `"captured"` refunds. Anything else is a no-op. */
  paymentStatus: string | null;
  /** Included in the log line so a stranded charge can be traced to its caller. */
  context: string;
  /** Cancellation must not record a refund if the provider did not accept it. */
  strict?: boolean;
}): Promise<void> {
  const stripe = getStripe();
  if (!input.paymentIntentId || isSkippedPaymentIntent(input.paymentIntentId)) {
    return;
  }
  if (!stripe) {
    if (
      input.strict &&
      ["authorized", "captured"].includes(input.paymentStatus ?? "")
    )
      throw new Error(
        "Payment provider unavailable; cancellation was not completed",
      );
    return;
  }

  if (input.paymentStatus === "authorized") {
    try {
      await stripe.paymentIntents.cancel(
        input.paymentIntentId,
        {},
        { idempotencyKey: `void_${input.paymentIntentId}` },
      );
    } catch (error) {
      if (input.strict) throw error;
      console.error(
        `[voidCharge] PI cancel failed (${input.context}, ${input.paymentIntentId}):`,
        error,
      );
    }
    return;
  }

  if (input.paymentStatus === "captured") {
    try {
      const refund = await stripe.refunds.create(
        { payment_intent: input.paymentIntentId },
        { idempotencyKey: `refund_${input.paymentIntentId}` },
      );
      if (input.strict && refund.status !== "succeeded")
        throw new Error("Refund is pending confirmation or failed; cancellation was not completed");
    } catch (error) {
      if (input.strict) throw error;
      console.error(
        `[voidCharge] refund failed (${input.context}, ${input.paymentIntentId}):`,
        error,
      );
    }
  }
}
