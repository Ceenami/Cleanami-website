import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { rentalCheckoutAttempts } from "@/db/schemas";
import { eq } from "drizzle-orm";
import { getStripe } from "@/lib/stripe/get-stripe";
import { rentalFinanceReady, RENTAL_FINANCE_POLICY } from "@/lib/services/payment/rental-finance-settings";
import { auditFinance } from "@/lib/services/payment/rental-finance-admin";
export async function POST(request: NextRequest) {
  const input = z.object({ clientSecret: z.string().min(20).max(500), accepted: z.literal(true) }).strict().safeParse(await request.json().catch(() => null));
  if (!input.success || !rentalFinanceReady()) return NextResponse.json({ error: "Invalid agreement request" }, { status: 400 });
  const id = input.data.clientSecret.split("_secret_")[0];
  if (!/^pi_[A-Za-z0-9_-]+$/.test(id)) return NextResponse.json({ error: "Invalid payment" }, { status: 400 });
  try {
    const stripe = getStripe(); if (!stripe) throw Error("Payment provider unavailable");
    const pi = await stripe.paymentIntents.retrieve(id);
    const attempt = pi.metadata.rental_checkout_attempt_id ? await db.query.rentalCheckoutAttempts.findFirst({ where: eq(rentalCheckoutAttempts.id, pi.metadata.rental_checkout_attempt_id) }) : null;
    if (!attempt || attempt.paymentIntentId !== id || pi.client_secret !== input.data.clientSecret ||
        pi.metadata.rental_finance_policy !== RENTAL_FINANCE_POLICY || attempt.terms.financePolicy !== RENTAL_FINANCE_POLICY ||
        pi.amount !== attempt.providerParams.amount || !["requires_payment_method", "requires_confirmation", "requires_action"].includes(pi.status))
      return NextResponse.json({ error: "Payment agreement could not be verified" }, { status: 403 });
    await auditFinance(db, `consent:${id}`, String(attempt.providerParams.customer), "accept_financial_terms", "Explicit checkout agreement before payment confirmation", null, null,
      { policy: RENTAL_FINANCE_POLICY, checkoutAttemptId: attempt.id, scheduledPayment: "after_final_evidence", lateFee: "full_frozen_scheduled_price_inside_24h", credit: "property_scoped_no_expiry_separate_from_fee" });
    return NextResponse.json({ accepted: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "Could not record agreement. Retry before confirming payment." }, { status: 503 }); }
}
