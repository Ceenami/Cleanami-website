import "server-only";
import { sendExecutionNotice } from "./execution-notices";
import { db } from "@/db";
import {
  evidencePackets,
  jobOperationAudit,
  jobs,
  jobsToCleaners,
  payouts,
} from "@/db/schemas";
import { and, eq } from "drizzle-orm";
import { getStripe } from "@/lib/stripe/get-stripe";
import { isSkippedPaymentIntent } from "@/lib/billing/customer-billing";
import { CLEANER_HOURLY_RATE } from "@/lib/pricing/staffing-logic";
import { computeCleanerPay } from "@/lib/pricing/cleaner-pay";
import { readResidentialSnapshot } from "@/lib/pricing/residential-v2/contracts";
import { readRentalCharge } from "@/lib/pricing/rental-charge";
import { verifySettledPayment } from "./verify-settled-payment";
import { ExecutionError } from "../job-execution";
import type { CancelJobResult } from "../customer-cancellation.service";

/** Cancellation claims the unstarted job before touching a provider. Retried claims
 * retain the original notice tier; a failed refund is never marked refunded. */
export async function cancelExecutionJob(
  jobId: string,
  source: "customer" | "admin",
): Promise<CancelJobResult> {
  const context = await db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .for("update");
    if (!job) throw new ExecutionError("Job not found", 404);
    const [claim] = await tx
      .select()
      .from(jobOperationAudit)
      .where(
        and(
          eq(jobOperationAudit.jobId, jobId),
          eq(jobOperationAudit.operation, "cancellation_claim"),
        ),
      );
    const [packet] = await tx
      .select()
      .from(evidencePackets)
      .where(eq(evidencePackets.jobId, jobId));
    if (
      !claim &&
      (!["unassigned", "assigned"].includes(job.status ?? "") ||
        packet?.gpsCheckInTimestamp)
    )
      throw new ExecutionError(
        "Started/settling jobs require a separately reviewed cancellation",
      );
    const assignments = await tx.query.jobsToCleaners.findMany({
      where: eq(jobsToCleaners.jobId, jobId),
      with: { cleaner: true },
    });
    const residential = readResidentialSnapshot(job.addonsSnapshot);
    const late = claim
      ? claim.identity === "late"
      : !(source === "admin" && residential.kind === "v2" && residential.terms.executionPolicy) &&
        assignments.some(a => ["primary", "laundry_lead"].includes(a.role)) &&
        !!job.checkInTime &&
        +job.checkInTime - Date.now() < 86400000;
    if (late && (residential.kind === "v1" || residential.kind === "v2")) {
      for (const a of assignments.filter(a => ["primary", "laundry_lead"].includes(a.role)))
        computeCleanerPay({ residentialPricing: job.addonsSnapshot?.residentialPricing,
          assignmentTerms: a.residentialPayTerms, settlement: "late_cancellation",
          expectedHours: Number(job.expectedHours), hourlyRateCents: a.frozenHourlyRateCents,
          role: a.role, laundryLoads: job.addonsSnapshot?.laundryLoads, urgentBonus: a.urgentBonus });
    }
    if (!claim) {
      await tx.insert(jobOperationAudit).values({
        jobId,
        actor: source,
        operation: "cancellation_claim",
        identity: late ? "late" : "on-time",
      });
      await tx
        .update(jobs)
        .set({ status: "canceled", updatedAt: new Date() })
        .where(eq(jobs.id, jobId));
    }
    return { job, assignments, late };
  });
  const [done] = await db
    .select()
    .from(jobOperationAudit)
    .where(
      and(
        eq(jobOperationAudit.jobId, jobId),
        eq(jobOperationAudit.operation, "cancellation_done"),
      ),
    );
  if (done)
    return {
      jobId,
      lateCancel: context.late,
      cleanersReleased: 0,
      customerCharged: context.job.paymentStatus === "captured",
      cleanerPaid: context.late,
      message: "Cancellation already completed",
    };
  const intentId = context.job.paymentIntentId;
  let charged = false,
    refunded = false;
  if (intentId && !isSkippedPaymentIntent(intentId)) {
    const stripe = getStripe();
    if (!stripe)
      throw new ExecutionError(
        "Job canceled; payment reversal is pending. Retry when the provider is available",
        503,
      );
    let intent = await stripe.paymentIntents.retrieve(intentId);
    if (context.late) {
      if (intent.status === "requires_capture")
        intent = await stripe.paymentIntents.capture(
          intentId,
          {},
          { idempotencyKey: `execution-v1-late-cancel:${jobId}` },
        );
      if (intent.status !== "succeeded")
        throw new ExecutionError(
          "Job canceled; late-cancellation billing requires review",
        );
      const terms = readResidentialSnapshot(context.job.addonsSnapshot);
      const expected = terms.kind === "v1" || terms.kind === "v2"
        ? Number(terms.terms.amountChargedCents) : readRentalCharge(context.job.rentalCharge)?.chargeAmountCents;
      try { await verifySettledPayment(stripe, intent, expected ?? intent.amount); }
      catch { throw new ExecutionError("Job canceled; refunded or missing charge, amount or currency mismatch requires billing review before cleaner pay"); }
      charged = true;
    } else if (intent.status === "succeeded") {
      const charge =
        typeof intent.latest_charge === "string"
          ? await stripe.charges.retrieve(intent.latest_charge)
          : intent.latest_charge;
      if (!charge)
        throw new ExecutionError(
          "Job canceled; missing charge requires refund review",
        );
      if (charge.amount_refunded === charge.amount) refunded = true;
      else {
        if (charge.amount_refunded > 0)
          throw new ExecutionError(
            "Job canceled; partial prior refund requires review",
          );
        const refund = await stripe.refunds.create(
          { payment_intent: intentId, metadata: { job_id: jobId } },
          { idempotencyKey: `execution-v1-cancel-refund:${jobId}` },
        );
        if (refund.status !== "succeeded")
          throw new ExecutionError(
            "Job canceled; refund is pending confirmation",
          );
        refunded = true;
      }
    } else if (intent.status !== "canceled") {
      await stripe.paymentIntents.cancel(
        intentId,
        {},
        { idempotencyKey: `execution-v1-cancel-intent:${jobId}` },
      );
    }
  } else if (
    context.late &&
    context.job.jobSource !== "manual" &&
    !isSkippedPaymentIntent(intentId)
  ) {
    throw new ExecutionError(
      "Job canceled; missing payment identity requires late-cancellation billing review",
    );
  }
  const result = await db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .for("update");
    if (job.status !== "canceled" || job.paymentIntentId !== intentId)
      throw new ExecutionError(
        "Cancellation changed; reconcile the payment before retrying",
      );
    const [complete] = await tx
      .select()
      .from(jobOperationAudit)
      .where(
        and(
          eq(jobOperationAudit.jobId, jobId),
          eq(jobOperationAudit.operation, "cancellation_done"),
        ),
      );
    if (!complete && context.late) {
      // Preserve the established cancellation payout rule (distinct from completed-job pay).
      const terms = readResidentialSnapshot(job.addonsSnapshot);
      const residential = terms.kind === "v1" || terms.kind === "v2";
      const primary = context.assignments.filter((a) => residential ? ["primary", "laundry_lead"].includes(a.role) : a.role === "primary");
      const targets = primary.length
        ? primary
        : context.assignments.filter(
            (a) => a.role !== "backup" && a.role !== "on-call",
          );
      for (const a of targets) {
        const pay = residential ? computeCleanerPay({
          residentialPricing: job.addonsSnapshot?.residentialPricing,
          assignmentTerms: a.residentialPayTerms, settlement: "late_cancellation",
          expectedHours: Number(job.expectedHours), hourlyRateCents: a.frozenHourlyRateCents,
          role: a.role, laundryLoads: job.addonsSnapshot?.laundryLoads, urgentBonus: a.urgentBonus,
        }) : null;
        const amount = pay?.total ?? Number(job.expectedHours || "0") * CLEANER_HOURLY_RATE + (a.urgentBonus ? 10 : 0);
        await tx
          .insert(payouts)
          .values({
            jobId,
            cleanerId: a.cleanerId,
            amount: amount.toFixed(2),
            payReceipt: pay?.receipt ?? null,
            urgentBonusAmount: pay ? (pay.urgentBonus ? pay.urgentBonus.toFixed(2) : null) : a.urgentBonus ? "10.00" : null,
            status: "pending",
          })
          .onConflictDoNothing({ target: [payouts.jobId, payouts.cleanerId] });
      }
    }
    if (!complete) {
      await tx.delete(jobsToCleaners).where(eq(jobsToCleaners.jobId, jobId));
      await tx
        .update(jobs)
        .set({
          paymentStatus: refunded ? "refunded" : charged ? "captured" : null,
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, jobId));
      await tx.insert(jobOperationAudit).values({
        jobId,
        actor: source,
        operation: "cancellation_done",
        identity: "once",
      });
    }
    return {
      changed: !complete,
      jobId,
      lateCancel: context.late,
      cleanersReleased: complete ? 0 : context.assignments.length,
      customerCharged: charged,
      cleanerPaid: context.late,
      message: context.late
        ? "Job canceled; late-cancellation payment and cleaner pay recorded"
        : "Job canceled; payment reversal confirmed or no charge was due",
    };
  });
  const { changed, ...response } = result;
  if (changed)
    await sendExecutionNotice(
      jobId,
      "canceled",
      context.late
        ? "This was a late cancellation; the assigned cleaner will still be paid."
        : refunded
          ? "Your prepaid charge was refunded in full."
          : "No charge applies to this on-time cancellation.",
    );
  return response;
}
