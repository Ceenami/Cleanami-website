import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { jobs, residentialCheckoutAttempts as attempts } from "@/db/schemas";
import {
  buildResidentialJobStaffing,
  type ResidentialV2Terms,
} from "@/lib/pricing/residential";
import { readResidentialSnapshot } from "@/lib/pricing/residential-v2/contracts";
import type Stripe from "stripe";

type Attempt = typeof attempts.$inferSelect;
export class ResidentialCheckoutReviewRequired extends Error {}
export const residentialCheckoutSlot = (
  source: "public" | "portal",
  parts: string[],
) =>
  createHash("sha256")
    .update(JSON.stringify([source, ...parts]))
    .digest("hex");

/** Recover accepted portal terms before consulting today's sale flag/property.
 * A canceled issued booking releases the slot for a new sale generation.
 */
export async function loadReusableResidentialCheckout(slotKey: string) {
  const attempt = await db.query.residentialCheckoutAttempts.findFirst({
    where: eq(attempts.slotKey, slotKey),
    orderBy: [desc(attempts.generation)],
  });
  if (!attempt) return null;
  const saved = await db.query.jobs.findFirst({
    where: eq(jobs.residentialCheckoutAttemptId, attempt.id),
  });
  if (saved?.status === "canceled") return null;
  if (attempt.terms.ruleVersion !== "residential-v2")
    throw new Error("Corrupt checkout version");
  readResidentialSnapshot(
    buildResidentialJobStaffing(
      attempt.terms,
      attempt.amountChargedCents,
      0,
      attempt.terms.amountCents - attempt.amountChargedCents,
    ).addonsSnapshot,
  );
  return attempt;
}

/** Commit the attempt BEFORE provider work, so a lost response cannot create a
 * second provider key. Scope locks once payment starts. Concurrent changed
 * scopes are refused instead of taking two payments for one intended booking.
 */
export async function prepareResidentialCheckout(input: {
  slotKey: string;
  requestIdentity: string;
  terms: ResidentialV2Terms;
  amountChargedCents: number;
}): Promise<Attempt> {
  if (
    input.terms.ruleVersion !== "residential-v2" ||
    (input.amountChargedCents !== 0 &&
      input.amountChargedCents !== input.terms.amountCents)
  )
    throw new Error("Invalid residential checkout money/version");
  const frozen = buildResidentialJobStaffing(
    input.terms,
    input.amountChargedCents,
    0,
    input.terms.amountCents - input.amountChargedCents,
  );
  readResidentialSnapshot(frozen.addonsSnapshot);
  if (frozen.addonsSnapshot.requiresManualStaffing)
    throw new Error("Manual scope cannot start an automated checkout");
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`checkout:${input.slotKey}`},0))`,
    );
    const current = await tx.query.residentialCheckoutAttempts.findFirst({
      where: eq(attempts.slotKey, input.slotKey),
      orderBy: [desc(attempts.generation)],
    });
    if (current) {
      const saved = await tx.query.jobs.findFirst({
        where: eq(jobs.residentialCheckoutAttemptId, current.id),
      });
      // A canceled, recorded booking is a new intended booking. Generation
      // creates a new key while preserving the previous paid/refunded attempt.
      if (saved?.status !== "canceled") {
        if (
          current.requestIdentity !== input.requestIdentity ||
          current.amountChargedCents !== input.amountChargedCents
        )
          throw new ResidentialCheckoutReviewRequired(
            "Payment has already started for a different scope. Review the existing booking or contact CleanNami before changing it.",
          );
        return current;
      }
    }
    const [attempt] = await tx
      .insert(attempts)
      .values({ ...input, generation: (current?.generation ?? 0) + 1 })
      .returning();
    if (!attempt) throw new Error("Checkout attempt was not saved");
    return attempt;
  });
}

export async function getOrCreateResidentialCheckoutPayment(
  attempt: Attempt,
  stripe: Stripe,
  create: (idempotencyKey: string) => Promise<Stripe.PaymentIntent>,
) {
  // Provider idempotency retention is finite. An uncertain old create with no
  // bound PI needs reconciliation, never a fresh charge after key expiry.
  if (
    !attempt.paymentIntentId &&
    Date.now() - attempt.createdAt.getTime() > 20 * 60 * 60 * 1000
  )
    throw new ResidentialCheckoutReviewRequired(
      "This payment attempt needs reconciliation. Contact CleanNami before retrying payment.",
    );
  const intent = attempt.paymentIntentId
    ? await stripe.paymentIntents.retrieve(attempt.paymentIntentId)
    : await create(`residential_v2_${attempt.id}`);
  if (
    intent.amount !== attempt.amountChargedCents ||
    intent.currency !== "usd" ||
    intent.metadata.residential_checkout_attempt !== attempt.id ||
    intent.metadata.request_identity !== attempt.requestIdentity
  )
    throw new Error("Provider payment does not match pinned checkout terms");
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(attempts)
      .where(eq(attempts.id, attempt.id))
      .for("update");
    if (!row || (row.paymentIntentId && row.paymentIntentId !== intent.id))
      throw new Error("Checkout payment binding conflict");
    if (!row.paymentIntentId)
      await tx
        .update(attempts)
        .set({ paymentIntentId: intent.id })
        .where(eq(attempts.id, row.id));
  });
  return intent;
}

export async function verifyResidentialCheckoutAttempt(
  id: string,
  paymentIntentId: string,
  requestIdentity: string,
) {
  const attempt = await db.query.residentialCheckoutAttempts.findFirst({
    where: and(
      eq(attempts.id, id),
      eq(attempts.requestIdentity, requestIdentity),
    ),
  });
  if (!attempt || attempt.paymentIntentId !== paymentIntentId)
    throw new Error("Checkout terms/payment binding not found");
  if (attempt.terms.ruleVersion !== "residential-v2")
    throw new Error("Corrupt checkout version");
  readResidentialSnapshot(
    buildResidentialJobStaffing(
      attempt.terms,
      attempt.amountChargedCents,
      0,
      attempt.terms.amountCents - attempt.amountChargedCents,
    ).addonsSnapshot,
  );
  return attempt;
}

export async function markResidentialCheckoutIssued(id: string, jobId: string) {
  await db.update(attempts).set({ jobId }).where(eq(attempts.id, id));
}
