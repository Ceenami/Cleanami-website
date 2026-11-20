import "server-only";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { evidencePackets, jobs, jobsToCleaners, phase2cAudit } from "@/db/schemas";
import { readConditionReview } from "@/lib/booking/condition-review";
import { readResidentialSnapshot } from "@/lib/pricing/residential-v2/contracts";
import { isSkippedPaymentIntent } from "@/lib/billing/customer-billing";
import { getStripe } from "@/lib/stripe/get-stripe";
import { inspectBookingReversal, requestBookingReversal } from "./payment/booking-reversal";
import { sendCancellationEmail } from "./email.service";
import { notifyCleaner } from "./notifications/notify";
import { notifyAdmins } from "@/lib/queries/admin-notifications";

const REJECTION = "condition_rejection", ATTEMPT = "condition_refund_attempt", OBSERVATION = "condition_refund_observation";
export const conditionReviewActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reviewed") }).strict(),
  z.object({ action: z.literal("reject"), reason: z.string().trim().min(1).max(2000), retryRefund: z.boolean().optional() }).strict(),
]);
const rejectionSchema = z.object({ reason: z.string().min(1), paymentIntentId: z.string().nullable(),
  cleanerIds: z.array(z.string()), cleanerCompensation: z.literal("separate_review") });
const attemptSchema = z.object({ generation: z.number().int().positive(), amountCents: z.number().int().nonnegative(), captured: z.boolean() });
export class ConditionReviewError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
type Writer = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function audits(writer: Writer | typeof db, id: string, kind: string) {
  return writer.select().from(phase2cAudit).where(and(eq(phase2cAudit.subjectId, id), eq(phase2cAudit.kind, kind)));
}
async function lockJob(tx: Writer, jobId: string) {
  const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId)).for("update");
  if (!job) throw new ConditionReviewError("Job not found", 404);
  if (job.serviceType !== "residential_one_time" || !readConditionReview(job.addonsSnapshot))
    throw new ConditionReviewError("This booking has no exceptional-condition review flag");
  return job;
}
export async function loadConditionReview(jobId: string) {
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (!job) throw new ConditionReviewError("Job not found", 404);
  const condition = readConditionReview(job.addonsSnapshot);
  if (!condition) return null;
  const history = await db.select().from(phase2cAudit).where(eq(phase2cAudit.subjectId, jobId));
  const rejection = history.find(r => r.kind === REJECTION);
  const observations = history.filter(r => r.kind === OBSERVATION);
  const latest = observations.sort((a, b) => Number(b.payload.sequence) - Number(a.payload.sequence))[0];
  return { ...condition, jobStatus: job.status, paymentStatus: job.paymentStatus,
    reviewed: history.some(r => r.kind === "condition_reviewed"),
    rejection: rejection ? { reason: rejectionSchema.parse(rejection.payload).reason, actorId: rejection.actorId, createdAt: rejection.createdAt } : null,
    refund: latest?.payload ?? null,
    notices: history.filter(r => r.kind.startsWith("condition_rejection_") && !r.kind.endsWith("_outcome")).map(claim => {
      const outcome = history.find(r => r.kind === `${claim.kind}_outcome` && r.payload.claimId === claim.id);
      return { kind: claim.kind, status: String(outcome?.payload.status ?? "unknown") };
    }),
    cleanerCompensation: rejection ? "separate_review" : null,
  };
}

/** Claim before dispatch; an uncertain external send is not automatically replayed.
 * Per-channel provider attempts remain visible in existing notification logs. */
async function noticeOnce(jobId: string, kind: string, actorId: string, send: () => Promise<unknown>) {
  const claim = await db.transaction(async tx => {
    await tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, jobId)).for("update");
    if ((await audits(tx, jobId, kind)).length) return null;
    const [row] = await tx.insert(phase2cAudit).values({ subjectId: jobId, kind, actorId, payload: { status: "unknown" } }).returning();
    return row;
  });
  if (!claim) return;
  try {
    const outcome = await send();
    await db.insert(phase2cAudit).values({ subjectId: jobId, kind: `${kind}_outcome`, actorId,
      payload: { claimId: claim.id, status: outcome === 0 ? "skipped" : typeof outcome === "object" && outcome && "success" in outcome && !outcome.success ? "failed" : "dispatch_completed" } });
  } catch {
    await db.insert(phase2cAudit).values({ subjectId: jobId, kind: `${kind}_outcome`, actorId, payload: { claimId: claim.id, status: "unknown" } });
  }
}

export async function actOnConditionReview(jobId: string, actorId: string, raw: unknown) {
  const action = conditionReviewActionSchema.parse(raw);
  const context = await db.transaction(async tx => {
    const job = await lockJob(tx, jobId);
    const [existing] = await audits(tx, jobId, REJECTION);
    if (action.action === "reviewed") {
      if (existing || !["unassigned", "assigned"].includes(job.status ?? "")) throw new ConditionReviewError("Only an open booking can be marked reviewed");
      if (!(await audits(tx, jobId, "condition_reviewed")).length)
        await tx.insert(phase2cAudit).values({ subjectId: jobId, kind: "condition_reviewed", actorId, payload: {} });
      return null;
    }
    if (existing) {
      const decision = rejectionSchema.parse(existing.payload);
      if (decision.reason !== action.reason || decision.paymentIntentId !== job.paymentIntentId || job.status !== "canceled")
        throw new ConditionReviewError("The rejection is already recorded. Reconcile the existing decision before making changes.");
      return { job, decision };
    }
    const [packet] = await tx.select().from(evidencePackets).where(eq(evidencePackets.jobId, jobId));
    if (!["unassigned", "assigned"].includes(job.status ?? "") || packet?.gpsCheckInTimestamp)
      throw new ConditionReviewError("Started, completed or canceled work requires separate review");
    // Validate explicit contracts before changing status or money; absence is legacy.
    readResidentialSnapshot(job.addonsSnapshot);
    const assignments = await tx.select().from(jobsToCleaners).where(eq(jobsToCleaners.jobId, jobId));
    const decision = { reason: action.reason, paymentIntentId: job.paymentIntentId, assignments,
      cleanerIds: assignments.map(a => a.cleanerId), cleanerCompensation: "separate_review" as const };
    await tx.insert(phase2cAudit).values({ subjectId: jobId, kind: REJECTION, actorId, payload: decision });
    await tx.update(jobs).set({ status: "canceled", updatedAt: new Date() }).where(eq(jobs.id, jobId));
    await tx.delete(jobsToCleaners).where(eq(jobsToCleaners.jobId, jobId));
    // No payout changes: the snapshot and original assignments remain in audit.
    return { job, decision };
  });
  if (!context || action.action === "reviewed") return { status: "reviewed", message: "Condition reviewed. Booking continues normally." };
  const { job, decision } = context;
  const customerJob = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId), with: { property: { with: { customer: true } } } });
  const customer = customerJob?.property?.customer;
  await noticeOnce(jobId, "condition_rejection_customer_notice", actorId, async () => {
    if (!customer?.email) throw new Error("Missing recipient");
    return sendCancellationEmail({ to: customer.email, name: customer.name, propertyAddress: customerJob!.property!.address,
      detail: `We cannot perform this clean. Reason: ${decision.reason} No customer cancellation penalty applies. Any payment will be refunded in full; refund confirmation is pending.` });
  });
  for (const cleanerId of decision.cleanerIds)
    await noticeOnce(jobId, `condition_rejection_cleaner_${cleanerId}`, actorId, () => notifyCleaner({ cleanerId, type: "assignment", jobId,
      title: "Clean canceled by management", message: "This booking was rejected after condition review. You are no longer assigned. Contact management about any compensation questions.", url: "/cleaner/jobs" }));
  await noticeOnce(jobId, "condition_rejection_admin_notice", actorId, () => notifyAdmins({ type: "booking_alert", jobId,
    title: "Condition review: booking rejected", message: "The booking was canceled without a customer penalty. Check refund progress and review any cleaner compensation separately.",
    url: `/admin/job-oversight/${jobId}`, email: true }));

  type Outcome = "refunded" | "no_charge" | "pending" | "failed" | "review_required";
  let status: Outcome = "review_required";
  let financial: Record<string, unknown> = { paymentIntentId: job.paymentIntentId };
  const recordObservation = (observed: Awaited<ReturnType<typeof inspectBookingReversal>>) => {
    financial = { ...financial, collectedCents: observed.intent.amount_received,
      refundedCents: observed.refundedCents, pendingCents: observed.pendingCents,
      refundIds: observed.refunds.map(r => r.id) };
  };
  try {
    if (isSkippedPaymentIntent(job.paymentIntentId)) status = "no_charge";
    else if (!job.paymentIntentId) {
      const contract = readResidentialSnapshot(job.addonsSnapshot);
      if (contract.kind === "v2" && contract.terms.amountChargedCents === 0 && contract.terms.exception === "owner_comp") status = "no_charge";
    } else {
      const stripe = getStripe();
      if (!stripe) throw new Error("Provider unavailable");
      const contract = readResidentialSnapshot(job.addonsSnapshot);
      const expected = contract.kind === "v2" ? contract.terms.amountChargedCents
        : contract.kind === "v1" ? Number(contract.terms.amountChargedCents) : undefined;
      let observed = await inspectBookingReversal(stripe, job.paymentIntentId, expected);
      recordObservation(observed);
      if (observed.intent.status === "canceled") status = "no_charge";
      else if (observed.intent.status === "succeeded" && observed.remainingCents === 0) status = "refunded";
      else if (observed.pendingCents > 0) status = "pending";
      else {
        // Immutable attempt identity/amount are shared by simultaneous retries.
        const attempt = await db.transaction(async tx => {
          const locked = await lockJob(tx, jobId);
          if (locked.status !== "canceled" || locked.paymentIntentId !== job.paymentIntentId) throw new ConditionReviewError("Payment binding changed");
          const previous = (await audits(tx, jobId, ATTEMPT)).sort((a, b) => attemptSchema.parse(b.payload).generation - attemptSchema.parse(a.payload).generation)[0];
          if (previous) {
            const refund = observed.refunds.find(r => r.metadata?.condition_refund_attempt === previous.id);
            if (!refund || !["failed", "canceled"].includes(refund.status ?? "") || !action.retryRefund) return previous;
          }
          const [next] = await tx.insert(phase2cAudit).values({ subjectId: jobId, kind: ATTEMPT, actorId,
            payload: { generation: previous ? attemptSchema.parse(previous.payload).generation + 1 : 1,
              amountCents: observed.remainingCents, captured: observed.intent.status === "succeeded" } }).returning();
          return next;
        });
        const terms = attemptSchema.parse(attempt.payload);
        financial.attemptId = attempt.id;
        const known = observed.refunds.find(r => r.metadata?.condition_refund_attempt === attempt.id);
        if (known && ["failed", "canceled"].includes(known.status ?? "")) status = "failed";
        else if (Date.now() - +attempt.createdAt > 20 * 3600000 || terms.amountCents !== observed.remainingCents || terms.captured !== (observed.intent.status === "succeeded"))
          status = "review_required";
        else {
          const requested = await requestBookingReversal(stripe, { paymentIntentId: job.paymentIntentId, jobId, attemptId: attempt.id, ...terms });
          if (requested) financial.requestedRefundId = requested.id;
          observed = await inspectBookingReversal(stripe, job.paymentIntentId, expected);
          recordObservation(observed);
          status = observed.intent.status === "canceled" ? "no_charge"
            : observed.remainingCents === 0 && observed.intent.status === "succeeded" ? "refunded"
            : requested && ["failed", "canceled"].includes(requested.status ?? "") ? "failed" : "pending";
        }
      }
    }
  } catch (error) {
    // Includes provider timeouts: retain the attempt and key, never report success.
    status = "review_required";
    financial.issue = "Payment/provider result requires reconciliation";
    console.warn("[condition-review] reversal needs reconciliation", { jobId, errorType: error instanceof Error ? error.name : "unknown" });
  }
  await db.transaction(async tx => {
    const locked = await lockJob(tx, jobId);
    if (locked.status !== "canceled" || locked.paymentIntentId !== job.paymentIntentId) throw new ConditionReviewError("Rejection changed; reconcile payment");
    // A slower concurrent retry must never overwrite an already confirmed
    // observation with its older pending/unknown response.
    const observations = await audits(tx, jobId, OBSERVATION);
    const confirmed = observations.find(r => ["refunded", "no_charge"].includes(String(r.payload.status)));
    if (confirmed) {
      status = confirmed.payload.status as "refunded" | "no_charge";
      financial = confirmed.payload;
    }
    if (status === "refunded" || status === "no_charge")
      await tx.update(jobs).set({ paymentStatus: status === "refunded" ? "refunded" : null, updatedAt: new Date() }).where(eq(jobs.id, jobId));
    await tx.insert(phase2cAudit).values({ subjectId: jobId, kind: OBSERVATION, actorId,
      payload: { ...financial, status, sequence: observations.length + 1, customerPenaltyCents: 0 } });
  });
  if (status === "refunded" || status === "no_charge")
    await noticeOnce(jobId, "condition_rejection_reversal_notice", actorId, async () => {
      if (!customer?.email) throw new Error("Missing recipient");
      return sendCancellationEmail({ to: customer.email, name: customer.name, propertyAddress: customerJob!.property!.address,
        detail: `Reason: ${decision.reason} No customer cancellation penalty applies. ${status === "refunded" ? "Your payment has been refunded in full. Your bank may take time to display it." : "No captured charge remains for this booking."}` });
    });
  return { status, message: status === "refunded" ? "Booking rejected; full refund confirmed."
    : status === "no_charge" ? "Booking rejected; no captured charge remains."
    : `Booking rejected; refund ${status === "review_required" ? "requires reconciliation" : status}. No customer penalty applies.`,
    cleanerCompensation: "separate_review" };
}
