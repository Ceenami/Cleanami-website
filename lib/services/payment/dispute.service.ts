import "server-only";

import { db } from "@/db";
import { jobs, payouts, stripeDisputes } from "@/db/schemas";
import { notifyAdminsOfJobAlert } from "@/lib/queries/cleaner-notifications";
import { and, eq } from "drizzle-orm";
import type Stripe from "stripe";

/**
 * Task 1.23 — record a Stripe dispute and apply the claw-back policy.
 *
 * Claw-back policy (spec §5/§20.4): a cleaner's pay is NOT automatically
 * reversed — that only happens on proven fraud/false evidence via an admin
 * override. What we do automatically is defensive: record the dispute (so the
 * reserve rate can react) and, when it opens, HOLD any still-pending payouts for
 * the job so nothing is released while the dispute is open, then alert an admin.
 *
 * Best-effort and idempotent: safe to call for created/updated/closed events.
 */
export async function recordDisputeAndHoldPayouts(
  dispute: Stripe.Dispute,
  paymentIntentId: string | null,
  eventType: string
): Promise<void> {
  let jobId: string | null = null;
  if (paymentIntentId) {
    const job = await db.query.jobs.findFirst({
      where: eq(jobs.paymentIntentId, paymentIntentId),
      columns: { id: true },
    });
    jobId = job?.id ?? null;
  }

  await db
    .insert(stripeDisputes)
    .values({
      stripeDisputeId: dispute.id,
      paymentIntentId,
      jobId,
      amountCents: dispute.amount ?? null,
      reason: dispute.reason ?? null,
      status: dispute.status ?? null,
    })
    .onConflictDoUpdate({
      target: stripeDisputes.stripeDisputeId,
      set: { status: dispute.status ?? null, updatedAt: new Date() },
    });

  if (!jobId || eventType !== "charge.dispute.created") return;

  // Hold pending payouts (do not touch already-released ones).
  await db
    .update(payouts)
    .set({ status: "held", updatedAt: new Date() })
    .where(and(eq(payouts.jobId, jobId), eq(payouts.status, "pending")));

  await notifyAdminsOfJobAlert({
    title: "Chargeback opened",
    message: `A customer dispute (${
      dispute.reason ?? "unknown reason"
    }) was opened. Pending cleaner payouts for this job are on hold pending your review.`,
    jobId,
    outcome: "dispute_opened",
  });
}
