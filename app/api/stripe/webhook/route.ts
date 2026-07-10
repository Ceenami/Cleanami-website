import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { cleaners } from "@/db/schemas";
import { applyStripeAccountState } from "@/lib/cleaner/stripe-account-state";
import { stripe } from "@/lib/stripe/config";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";

export const runtime = "nodejs";

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

  if (event.type === "account.updated") {
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
  }

  return NextResponse.json({ received: true });
}
