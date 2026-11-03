import "server-only";
import type Stripe from "stripe";
import type { RentalCharge } from "@/lib/pricing/rental-charge";
import { verifySettledPayment } from "./verify-settled-payment";

/** Call while holding the job row lock. Cron and cancellation use the same
 * provider parameters/key, including after an uncertain authorization result. */
export async function authorizeRentalCharge(
  stripe: Stripe,
  jobId: string,
  customerId: string,
  charge: RentalCharge,
) {
  if (charge.skippedPayment) throw new Error("A complimentary clean cannot be authorized");
  const methods = await stripe.paymentMethods.list({ customer: customerId, type: "card" });
  if (!methods.data.length) throw new Error("No saved payment method found for this customer");
  const intent = await stripe.paymentIntents.create({
    amount: charge.chargeAmountCents,
    currency: "usd",
    customer: customerId,
    payment_method: methods.data[0].id,
    capture_method: "manual",
    confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    metadata: { jobId },
  }, { idempotencyKey: `preauth_${jobId}` });
  if (intent.amount !== charge.chargeAmountCents || intent.currency !== "usd" ||
      !["requires_capture", "succeeded"].includes(intent.status))
    throw new Error("Rental authorization amount, currency or status requires billing review");
  if (intent.status === "succeeded")
    await verifySettledPayment(stripe, intent, charge.chargeAmountCents);
  return intent;
}
