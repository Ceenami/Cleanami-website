import "server-only";
import type Stripe from "stripe";
import { db } from "@/db";
import { jobs } from "@/db/schemas";
import { eq } from "drizzle-orm";
import { appendJobNote } from "@/lib/jobs/job-notes";

const objectId = (value: string | { id: string } | null) =>
  typeof value === "string" ? value : value?.id ?? null;

/** A webhook is a reconciliation signal, not the current payment state.
 * Fetch provider truth AFTER locking the job: two distinct out-of-order events
 * cannot fetch old states in parallel and then overwrite each other's result. */
export async function reconcileStripePayment(
  stripe: Stripe,
  paymentIntentId: string,
  event: { id: string; type: string },
) {
  return db.transaction(async (tx) => {
    const [job] = await tx.select({ id: jobs.id, paymentStatus: jobs.paymentStatus,
      paymentFailed: jobs.paymentFailed, notes: jobs.notes,
    }).from(jobs).where(eq(jobs.paymentIntentId, paymentIntentId)).for("update");
    if (!job) return null;
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
    if (intent.id !== paymentIntentId || intent.currency !== "usd")
      throw new Error("Stripe payment identity/currency mismatch during reconciliation");
    let status: typeof job.paymentStatus;
    let refundedCents = 0, pendingRefundCents = 0;
    if (intent.status === "succeeded") {
      const charge = typeof intent.latest_charge === "string"
        ? await stripe.charges.retrieve(intent.latest_charge) : intent.latest_charge;
      if (!charge || !charge.paid || !charge.captured || charge.currency !== intent.currency ||
          objectId(charge.payment_intent) !== paymentIntentId ||
          !Number.isSafeInteger(intent.amount_received) || intent.amount_received <= 0)
        throw new Error("Stripe settled charge is missing or inconsistent");
      let cursor: string | undefined;
      const seen = new Set<string>();
      for (let page = 0; ; page++) {
        if (page >= 100) throw new Error("Stripe refund history exceeds reconciliation limit");
        const refunds = await stripe.refunds.list({ payment_intent: paymentIntentId,
          limit: 100, ...(cursor ? { starting_after: cursor } : {}),
        });
        for (const refund of refunds.data) {
          if (seen.has(refund.id) || !Number.isSafeInteger(refund.amount) || refund.amount < 0)
            throw new Error("Invalid Stripe refund history");
          seen.add(refund.id);
          if (objectId(refund.charge) !== charge.id) continue;
          if (refund.status === "succeeded") refundedCents += refund.amount;
          else if (refund.status === "pending" || refund.status === "requires_action")
            pendingRefundCents += refund.amount;
        }
        if (!refunds.has_more) break;
        const last = refunds.data.at(-1)?.id;
        if (!last || last === cursor) throw new Error("Incomplete Stripe refund pagination");
        cursor = last;
      }
      if (refundedCents > intent.amount_received)
        throw new Error("Stripe refunds exceed the collected payment");
      // A pending/failed/partial refund is not a completed full refund.
      status = refundedCents === intent.amount_received ? "refunded" : "captured";
    } else if (intent.status === "requires_capture") status = "authorized";
    else if (intent.status === "canceled") status = null;
    else if (intent.status === "requires_payment_method" && intent.last_payment_error) status = "failed";
    else status = "pending";
    const failed = status === "failed";
    const failureReason = intent.last_payment_error?.message ?? "unknown reason";
    await tx.update(jobs).set({ paymentStatus: status, paymentFailed: failed,
      notes: appendJobNote(job.notes,
        `[Stripe] ${event.type} (${event.id}): reconciled ${status ?? "no charge"}; successful refunds ${refundedCents} cents; pending refunds ${pendingRefundCents} cents.`),
      updatedAt: new Date(),
    }).where(eq(jobs.id, job.id));
    return { status, becameFailed: failed && job.paymentStatus !== "failed",
      failureReason, refundedCents, pendingRefundCents };
  });
}
