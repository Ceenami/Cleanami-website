import "server-only";

import { db } from "@/db";
import { customers } from "@/db/schemas";
import { createAdminClient } from "@/lib/supabase/server";
import { eq } from "drizzle-orm";

/**
 * Founder / super_admin portal accounts are never billed through Stripe.
 * Uses customers.skip_payment, kept in sync with auth role by email.
 */
export function customerSkipsBilling(
  customer: { skipPayment?: boolean | null } | null | undefined
): boolean {
  return customer?.skipPayment === true;
}

/**
 * Sentinel stored in `jobs.payment_intent_id` when the customer's billing is
 * skipped, so the job still reads as "authorized" and moves through the normal
 * lifecycle without any money having been held.
 *
 * It is NOT a Stripe id. Every branch that decides "do I have a payment intent?"
 * by truthiness alone will happily hand this string to Stripe, which rejects it
 * as an unknown intent — so guard with `isSkippedPaymentIntent` first.
 */
export const SKIPPED_PAYMENT_INTENT_ID = "skipped_owner_payment";

/** True when the job carries the skip-billing sentinel rather than a real intent. */
export function isSkippedPaymentIntent(
  paymentIntentId: string | null | undefined
): boolean {
  return paymentIntentId === SKIPPED_PAYMENT_INTENT_ID;
}

/** Align skip_payment with super_admin auth users sharing the same email. */
export async function syncSkipPaymentForSuperAdminCustomers(): Promise<void> {
  const supabaseAdmin = createAdminClient();
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });

  if (error) {
    console.warn("[syncSkipPaymentForSuperAdminCustomers]", error.message);
    return;
  }

  const superAdminEmails = data.users
    .filter((user) => user.app_metadata?.role === "super_admin")
    .map((user) => user.email?.toLowerCase())
    .filter((email): email is string => Boolean(email));

  for (const email of superAdminEmails) {
    await db
      .update(customers)
      .set({ skipPayment: true, updatedAt: new Date() })
      .where(eq(customers.email, email));
  }
}
