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
 * Best-effort by contract: it never throws. Every caller is already in a
 * failure path, and a void that fails must not mask the original error. It is
 * logged at error level rather than warn because a failed void means real money
 * is stranded with nothing recorded against it.
 */
export async function voidCharge(input: {
  paymentIntentId: string | null;
  /** `"authorized"` cancels, `"captured"` refunds. Anything else is a no-op. */
  paymentStatus: string | null;
  /** Included in the log line so a stranded charge can be traced to its caller. */
  context: string;
}): Promise<void> {
  const stripe = getStripe();
  if (
    !stripe ||
    !input.paymentIntentId ||
    isSkippedPaymentIntent(input.paymentIntentId)
  ) {
    return;
  }

  if (input.paymentStatus === "authorized") {
    try {
      await stripe.paymentIntents.cancel(input.paymentIntentId);
    } catch (error) {
      console.error(
        `[voidCharge] PI cancel failed (${input.context}, ${input.paymentIntentId}):`,
        error
      );
    }
    return;
  }

  if (input.paymentStatus === "captured") {
    try {
      await stripe.refunds.create({ payment_intent: input.paymentIntentId });
    } catch (error) {
      console.error(
        `[voidCharge] refund failed (${input.context}, ${input.paymentIntentId}):`,
        error
      );
    }
  }
}
