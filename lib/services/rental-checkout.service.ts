import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { db } from "@/db";
import { rentalCheckoutAttempts as attempts, type RentalCheckoutTerms } from "@/db/schemas";
import { desc, eq, sql } from "drizzle-orm";
import type Stripe from "stripe";
import type { SignupFormData } from "@/lib/validations/bookng-modal";
import { normalizeSignupFormDataForPricing } from "@/lib/validations/bookng-modal/serialize-signup-form";
import { assertMoneyRecoveryReady, PROVIDER_RETRY_WINDOW_MS } from "./payment/money-recovery-settings";

// Deliberate allowlist: access credentials and arbitrary client fields must
// never enter checkout snapshots or provider metadata.
const CONTRACT_FIELDS = ["name", "email", "phoneNumber", "address", "sqft", "bedrooms", "bathrooms",
  "laundryService", "laundryLoads", "petsAllowed", "hasHotTub", "hotTubService", "hotTubDrain", "hotTubDrainCadence",
  "subscriptionMonths", "firstCleanDate", "defaultCheckInTime", "defaultCheckOutTime", "iCalUrl", "promoCode"] as const;
export function rentalCheckoutForm(form: SignupFormData): Record<string, unknown> {
  const normalized = normalizeSignupFormDataForPricing(form);
  return Object.fromEntries(CONTRACT_FIELDS.flatMap(key => {
    const value = normalized[key];
    return value === undefined ? [] : [[key, value instanceof Date ? value.toISOString() : value]];
  }));
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const slot = (form: SignupFormData) => {
  if (!form.email || !form.address) throw new Error("Email and property address are required before payment");
  return hash([form.email.trim().toLowerCase(), form.address.trim().toLowerCase()]);
};
type Attempt = typeof attempts.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function lockSlot(tx: Tx, slotKey: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`rental-checkout:${slotKey}`},0))`);
  return tx.query.rentalCheckoutAttempts.findFirst({ where: eq(attempts.slotKey, slotKey), orderBy: [desc(attempts.generation)] });
}
function assertBinding(attempt: Attempt, pi: Stripe.PaymentIntent) {
  const customer = typeof pi.customer === "string" ? pi.customer : pi.customer?.id;
  if (pi.metadata?.rental_checkout_attempt_id !== attempt.id || pi.amount !== attempt.providerParams.amount ||
      pi.currency !== "usd" || customer !== attempt.providerParams.customer || attempt.terms.version !== 1) {
    throw new Error("Rental payment does not match frozen checkout. Contact CleanNami before paying again.");
  }
}
async function retrieveOrCreate(tx: Tx, stripe: Stripe, attempt: Attempt) {
  if (!attempt.paymentIntentId && Date.now() - attempt.createdAt.getTime() >= PROVIDER_RETRY_WINDOW_MS) {
    throw new Error("Payment outcome needs review after an interrupted checkout. Contact CleanNami before paying again.");
  }
  const options = { timeout: 10_000, maxNetworkRetries: 0 };
  const pi = attempt.paymentIntentId
    ? await stripe.paymentIntents.retrieve(attempt.paymentIntentId, options)
    : await stripe.paymentIntents.create(attempt.providerParams, { ...options, idempotencyKey: `rental_signup_${attempt.id}` });
  assertBinding(attempt, pi);
  if (!attempt.paymentIntentId) await tx.update(attempts).set({ paymentIntentId: pi.id }).where(eq(attempts.id, attempt.id));
  return pi;
}
function response(attempt: Attempt, pi: Stripe.PaymentIntent) {
  if (!pi.client_secret) throw new Error("Could not initialize payment. Contact CleanNami before paying again.");
  return { clientSecret: pi.client_secret, amountInCents: attempt.providerParams.amount,
    promoDiscountCents: attempt.terms.promoDiscountCents, minimumCommitmentPolicy: attempt.terms.minimumPolicy,
    termEndPolicy: attempt.terms.termPolicy, financePolicy: attempt.terms.financePolicy,
    subscriptionStartPolicy: attempt.terms.subscriptionStartPolicy };
}

/** Recover BEFORE today's price/notice/promo checks. Changed scope cancels a
 * known unpaid predecessor first; a succeeded/processing/unknown payment never
 * releases its slot to another charge.
 */
export async function recoverRentalCheckout(stripe: Stripe, form: SignupFormData) {
  assertMoneyRecoveryReady();
  const slotKey = slot(form), identity = hash(rentalCheckoutForm(form));
  return db.transaction(async tx => {
    const attempt = await lockSlot(tx, slotKey);
    if (!attempt) return null;
    const pi = await retrieveOrCreate(tx, stripe, attempt);
    if (pi.status === "canceled") return null;
    if (attempt.requestIdentity !== identity) {
      if (!["requires_payment_method", "requires_confirmation", "requires_action"].includes(pi.status)) {
        throw new Error("Payment has already started for different booking details. Contact CleanNami before paying again.");
      }
      const canceled = await stripe.paymentIntents.cancel(pi.id, {}, { timeout: 10_000, maxNetworkRetries: 0 });
      if (canceled.status !== "canceled") throw new Error("Previous checkout could not be canceled; contact CleanNami before paying again.");
      return null;
    }
    return response(attempt, pi);
  });
}

export async function createRentalCheckout(stripe: Stripe, form: SignupFormData, terms: RentalCheckoutTerms, providerParams: Stripe.PaymentIntentCreateParams) {
  assertMoneyRecoveryReady();
  const slotKey = slot(form), requestIdentity = hash(rentalCheckoutForm(form));
  // Commit immutable parameters BEFORE the external request. A crash or lost
  // response reuses this id/key, never a fresh randomly generated payment.
  const prepared = await db.transaction(async tx => {
    const current = await lockSlot(tx, slotKey);
    if (current) {
      const pi = await retrieveOrCreate(tx, stripe, current);
      if (pi.status !== "canceled") {
        if (current.requestIdentity !== requestIdentity) throw new Error("Checkout details changed concurrently. Retry the booking review before paying.");
        return current;
      }
    }
    const id = randomUUID();
    const [attempt] = await tx.insert(attempts).values({ id, slotKey, generation: (current?.generation ?? 0) + 1,
      requestIdentity, terms, providerParams: { ...providerParams, metadata: { ...providerParams.metadata, rental_checkout_attempt_id: id } } }).returning();
    return attempt;
  });
  return db.transaction(async tx => {
    await lockSlot(tx, slotKey);
    const current = await tx.query.rentalCheckoutAttempts.findFirst({ where: eq(attempts.id, prepared.id) });
    if (!current) throw new Error("Checkout attempt missing");
    const pi = await retrieveOrCreate(tx, stripe, current);
    if (pi.status === "canceled") throw new Error("Checkout was canceled. Review the booking and retry.");
    return response(current, pi);
  });
}

/** Marked payments must have their exact durable, server-written contract.
 * Never reconstruct new terms from today's prices or from client amounts.
 */
export async function loadPaidRentalCheckout(pi: Stripe.PaymentIntent, form: SignupFormData) {
  const attemptId = pi.metadata?.rental_checkout_attempt_id;
  if (!attemptId) return null; // Historical accepted purchases keep their path.
  assertMoneyRecoveryReady();
  const attempt = await db.query.rentalCheckoutAttempts.findFirst({ where: eq(attempts.id, attemptId) });
  if (!attempt || attempt.paymentIntentId !== pi.id) throw new Error("Paid rental checkout is missing or not bound; contact CleanNami");
  assertBinding(attempt, pi);
  if (attempt.requestIdentity !== hash(rentalCheckoutForm(form))) throw new Error("Paid booking scope changed. Restore the accepted booking details or contact CleanNami.");
  if (pi.metadata.subscription_minimum_policy !== attempt.terms.minimumPolicy || pi.metadata.subscription_term_end_policy !== attempt.terms.termPolicy ||
      pi.metadata.rental_finance_policy !== attempt.terms.financePolicy) {
    throw new Error("Paid rental policy does not match the accepted contract");
  }
  return attempt;
}
