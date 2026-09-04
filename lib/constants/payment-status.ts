/**
 * How a job's payment state is described to a human.
 *
 * One map, three surfaces — the admin job view, the customer portal, and
 * anything else that grows one later. Sibling of `service-type.ts`, and here for
 * the same reason: a label that each screen invents for itself is a label that
 * drifts, and "Paid" meaning two different things on two screens is worse than
 * no label at all.
 *
 * Two rules that keep it honest.
 *
 * **`canceled` comes from `jobs.status`, never from the payment enum.** One
 * fact, one column. That is why migration 0038 added only `refunded`: a second
 * column that can disagree with `jobs.status` about whether a job is cancelled
 * is a reconciliation bug waiting to be filed. "Refunded/canceled" is one
 * display concept over two facts, and this is where they are combined.
 *
 * **No payment status shows the customer NOTHING, never "unpaid".** Every job
 * predating the residential work has `payment_status IS NULL` because nobody
 * ever recorded one, not because nobody paid. Labelling those "unpaid" would
 * put a false statement on an existing surface.
 */

export type PaymentStatusValue =
  | "pending"
  | "authorized"
  | "captured"
  | "failed"
  | "capture_failed"
  | "refunded";

export type PaymentDisplay = {
  /** Wording for the customer portal. */
  customer: string;
  /** Wording for admin, which may name the mechanism. */
  admin: string;
  /** Drives the badge colour; no Tailwind classes here, so this file stays render-agnostic. */
  tone: "positive" | "negative" | "pending" | "neutral";
};

const BY_PAYMENT_STATUS: Record<PaymentStatusValue, PaymentDisplay> = {
  captured: { customer: "Paid", admin: "Paid", tone: "positive" },
  authorized: {
    customer: "Payment held",
    admin: "Authorized (hold)",
    tone: "pending",
  },
  pending: {
    customer: "Payment pending",
    admin: "Pending",
    tone: "pending",
  },
  failed: {
    customer: "Payment failed",
    admin: "Failed",
    tone: "negative",
  },
  capture_failed: {
    customer: "Payment failed",
    admin: "Capture failed",
    tone: "negative",
  },
  refunded: { customer: "Refunded", admin: "Refunded", tone: "neutral" },
};

const CANCELED_NO_CHARGE: PaymentDisplay = {
  customer: "Canceled — no charge",
  admin: "Canceled, no charge",
  tone: "neutral",
};

/**
 * The label for a job, or `null` when there is genuinely nothing to say.
 *
 * Pass both facts. A cancelled job with no payment status is "no charge", which
 * cannot be derived from either column alone — and a cancelled job that WAS
 * charged and refunded still reads "Refunded", because that is the more
 * specific truth.
 *
 * A *late* cancellation is the one case where "canceled" and "Paid" appear
 * together, and that is correct: the customer is charged and the cleaner is
 * paid. It is not a refund and must not display as one.
 */
export function getPaymentDisplay(
  jobStatus: string | null | undefined,
  paymentStatus: string | null | undefined
): PaymentDisplay | null {
  if (paymentStatus && paymentStatus in BY_PAYMENT_STATUS) {
    return BY_PAYMENT_STATUS[paymentStatus as PaymentStatusValue];
  }

  if (jobStatus === "canceled") return CANCELED_NO_CHARGE;

  // No status recorded, and not cancelled: say nothing rather than guess.
  return null;
}
