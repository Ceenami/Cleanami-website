import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { cleaners, jobs, payouts } from "@/db/schemas";
import { applyStripeAccountState } from "@/lib/cleaner/stripe-account-state";
import { claimStripeWebhook, finishStripeWebhook, failStripeWebhook } from "@/lib/services/stripe/event-dedupe";
import { sendPaymentFailedEmail } from "@/lib/services/email.service";
import { recordDisputeAndHoldPayouts } from "@/lib/services/payment/dispute.service";
import { notifyAdminsOfJobAlert } from "@/lib/queries/cleaner-notifications";
import { stripe } from "@/lib/stripe/config";
import { reconcileStripePayment } from "@/lib/services/payment/reconcile-stripe-payment";
import { reconcileRentalFinancialPayment } from "@/lib/services/payment/rental-finance-reconciliation";
import { eq, and } from "drizzle-orm";
import type Stripe from "stripe";

export const runtime = "nodejs";

/** Append a line to the notes of the job linked to a PaymentIntent. */
async function appendJobNoteByPaymentIntent(
  paymentIntentId: string | null,
  note: string,
  eventId: string
): Promise<void> {
  if (!paymentIntentId) return;
  await db.transaction(async tx => {
    const [job] = await tx.select({ id: jobs.id, notes: jobs.notes }).from(jobs)
      .where(eq(jobs.paymentIntentId, paymentIntentId)).for("update");
    const marker = `[Stripe event ${eventId}]`;
    if (!job || job.notes?.includes(marker)) return;
    await tx.update(jobs).set({ notes: `${job.notes ? `${job.notes}\n` : ""}${marker} ${note}`, updatedAt: new Date() }).where(eq(jobs.id, job.id));
  });
}

const objectId = (value: string | { id: string } | null) =>
  typeof value === "string" ? value : value?.id ?? null;

async function reconcilePayment(paymentIntentId: string | null, event: Stripe.Event) {
  if (!paymentIntentId) return;
  if (await reconcileRentalFinancialPayment(stripe, paymentIntentId, event.id)) return;
  const result = await reconcileStripePayment(stripe, paymentIntentId, event);
  if (result?.becameFailed) await notifyPaymentFailed(paymentIntentId, result.failureReason);
}

/**
 * Best-effort customer + admin notification for a failed charge. Spec §20.5:
 * `payment_intent.failed` → notify customer + admin. Never throws — a mail
 * failure must not fail the webhook (which would trigger a full Stripe retry).
 */
async function notifyPaymentFailed(
  paymentIntentId: string,
  reason: string
): Promise<void> {
  try {
    const job = await db.query.jobs.findFirst({
      where: eq(jobs.paymentIntentId, paymentIntentId),
      columns: { id: true },
      with: {
        subscription: { with: { customer: true } },
        property: { columns: { address: true } },
      },
    });
    if (!job) return;

    const customer = job.subscription?.customer;
    const address = job.property?.address ?? "your property";

    if (customer?.email) {
      await sendPaymentFailedEmail({
        to: customer.email,
        name: customer.name,
        propertyAddress: address,
      });
    }

    await notifyAdminsOfJobAlert({
      title: "Customer payment failed",
      message: `Payment failed for ${address}: ${reason}`,
      jobId: job.id,
      outcome: "payment_failed",
    });
  } catch (err) {
    console.error("[stripe webhook] payment-failed notification failed", err);
  }
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  // Cast to string so we can safely match event types that may not be in the
  // installed SDK's type union across API versions.
  const type = event.type as string;

  switch (type) {
    case "account.updated": {
      const account = event.data.object as Stripe.Account;
      const cleanerId = account.metadata?.cleanerId;
      if (cleanerId) {
        await applyStripeAccountState(cleanerId, account);
      } else if (account.id) {
        const cleaner = await db.query.cleaners.findFirst({
          where: eq(cleaners.stripeAccountId, account.id),
          columns: { id: true },
        });
        if (cleaner) {
          await applyStripeAccountState(cleaner.id, account);
        }
      }
      break;
    }

    case "payment_intent.succeeded":
    case "payment_intent.payment_failed":
    case "payment_intent.canceled":
    case "payment_intent.processing":
    case "payment_intent.amount_capturable_updated": {
      const pi = event.data.object as Stripe.PaymentIntent;
      await reconcilePayment(pi.id, event);
      break;
    }

    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      await reconcilePayment(objectId(charge.payment_intent), event);
      break;
    }

    case "refund.created":
    case "refund.updated":
    case "refund.failed":
    case "charge.refund.updated": {
      const refund = event.data.object as Stripe.Refund;
      let pi = objectId(refund.payment_intent);
      if (!pi && refund.charge) {
        const charge = await stripe.charges.retrieve(objectId(refund.charge)!);
        pi = objectId(charge.payment_intent);
      }
      await reconcilePayment(pi, event);
      break;
    }

    case "charge.dispute.created":
    case "charge.dispute.updated":
    case "charge.dispute.closed": {
      const dispute = event.data.object as Stripe.Dispute;
      const pi =
        typeof dispute.payment_intent === "string"
          ? dispute.payment_intent
          : null;
      if (pi && await reconcileRentalFinancialPayment(stripe, pi, event.id, true)) break;
      // Record the dispute (feeds reserve escalation) and, on open, hold the
      // job's pending payouts + alert admin (spec §5/§20.4 claw-back policy).
      await recordDisputeAndHoldPayouts(dispute, pi, type);
      await appendJobNoteByPaymentIntent(
        pi,
        `[Stripe] Dispute ${type.split(".").pop()}: status=${dispute.status}, reason=${dispute.reason} (${new Date(event.created * 1000).toISOString()})`,
        event.id
      );
      break;
    }

    case "transfer.paid": {
      const transfer = event.data.object as Stripe.Transfer;
      await db
        .update(payouts)
        .set({ status: "released", updatedAt: new Date() })
        .where(and(eq(payouts.stripePayoutId, transfer.id), eq(payouts.status, "pending")));
      break;
    }

    case "transfer.failed":
    case "transfer.reversed": {
      const transfer = event.data.object as Stripe.Transfer;
      // Failed/reversed transfers need admin attention — hold the payout.
      await db
        .update(payouts)
        .set({ status: "held", updatedAt: new Date() })
        .where(eq(payouts.stripePayoutId, transfer.id));
      break;
    }

    default:
      // Unhandled event types are acknowledged (200) so Stripe stops retrying.
      break;
  }
}

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json(
      { error: "Stripe webhook is not configured" },
      { status: 503 }
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const body = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error("[stripe webhook] signature verification failed", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let token: string | undefined;
  try {
    const claim = await claimStripeWebhook(event);
    if (claim.state === "completed") return NextResponse.json({ received: true, duplicate: true });
    if (claim.state === "busy") return NextResponse.json({ error: "Webhook processing in progress; retry" }, { status: 503 });
    token = claim.token;
    await handleEvent(event);
    await finishStripeWebhook(event.id, token);
  } catch (err) {
    if (token) {
      try { await failStripeWebhook(event.id, token); }
      catch (claimError) { console.error("[stripe webhook] claim recovery deferred to lease expiry", claimError); }
    }
    console.error(`[stripe webhook] handler failed for ${event.type}`, err);
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true });
}
