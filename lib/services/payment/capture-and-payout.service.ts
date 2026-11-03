import "server-only";
import { getExecutionContract } from "../job-execution-contract";
import { settleExecutionJob } from "./execution-settlement";

import { db } from "@/db";
import {
  jobs,
  evidencePackets,
  reserveTransactions,
  payouts,
  jobsToCleaners,
} from "@/db/schemas";
import { eq, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe/get-stripe";
import { SERVICE_UNAVAILABLE } from "@/lib/env/messages";
import { computeCleanerPay } from "@/lib/pricing/cleaner-pay";
import { readResidentialSnapshot } from "@/lib/pricing/residential-v2/contracts";
import { readRentalCharge } from "@/lib/pricing/rental-charge";
import { verifySettledPayment } from "./verify-settled-payment";
import { computeReserveRate } from "@/lib/services/payment/reserve";
import { sendJobCompletionEmail } from "@/lib/services/email.service";
import { evaluateArrival } from "@/lib/services/gps/geofence";
import { reconcileEvidenceAccountability } from "@/lib/services/gps/reconcile-evidence";
import { isSkippedPaymentIntent } from "@/lib/billing/customer-billing";
import { appendJobNote } from "@/lib/jobs/job-notes";
import { getJobDisplay } from "@/lib/constants/service-type";

/** Roles eligible for payout. */
const PAID_ROLES = new Set(["primary", "laundry_lead"]);

export type CaptureOutcome = {
  ok: boolean;
  httpStatus: number;
  body: Record<string, unknown>;
};

async function emailCompletion(
  customerEmail: string | null | undefined,
  customerName: string | null | undefined,
  propertyAddress: string | null | undefined,
  serviceLabel: string,
): Promise<void> {
  if (!customerEmail) return;
  try {
    await sendJobCompletionEmail({
      to: customerEmail,
      name: customerName ?? undefined,
      propertyAddress: propertyAddress ?? "your property",
      serviceLabel,
    });
  } catch (err) {
    console.error("[capture-and-payout] completion email failed:", err);
  }
}

/** Settle a completed job and create cleaner payouts. */
export async function captureAndCreatePayouts(
  jobId: string,
): Promise<CaptureOutcome> {
  // The issued protocol owns its own short claims and ledger transactions.
  // Dispatch before acquiring a legacy lock to avoid waiting on ourselves.
  if (await getExecutionContract(jobId)) return settleExecutionJob(jobId);
  const afterCommit: Array<() => Promise<void>> = [];
  const outcome = await db.transaction(async (tx) => {
    // Cancellation takes this same row lock. Read terms/status only after it
    // is held, and commit the job, reserve and whole team's payouts together.
    await tx.execute(sql`select id from jobs where id = ${jobId} for update`);
    return captureLocked(jobId, tx, afterCommit);
  });
  for (const action of afterCommit) await action();
  return outcome;
}

type CaptureWriter = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function captureLocked(
  jobId: string,
  db: CaptureWriter,
  afterCommit: Array<() => Promise<void>>,
): Promise<CaptureOutcome> {
  const job = await db.query.jobs.findFirst({
    where: eq(jobs.id, jobId),
    with: {
      subscription: { with: { customer: true } },
      // Subscription-less jobs resolve the customer through the property.
      property: { with: { customer: true } },
    },
  });

  if (!job) {
    return { ok: false, httpStatus: 404, body: { error: "Job not found" } };
  }

  if (job.status === "canceled" || job.paymentStatus === "refunded") {
    return {
      ok: false,
      httpStatus: 409,
      body: { error: "Canceled or refunded jobs cannot be settled." },
    };
  }

  const evidence = await db.query.evidencePackets.findFirst({
    where: eq(evidencePackets.jobId, jobId),
  });

  if (!evidence) {
    return {
      ok: false,
      httpStatus: 400,
      body: { error: "Evidence packet not found. Job cannot be completed." },
    };
  }

  const isEvidenceComplete =
    evidence.status === "complete" &&
    evidence.gpsCheckInTimestamp &&
    evidence.gpsCheckOutTimestamp &&
    evidence.finalEvidenceSubmittedAt &&
    evidence.isChecklistComplete &&
    evidence.photoUrls &&
    evidence.photoUrls.length > 0;

  if (!isEvidenceComplete) {
    return {
      ok: false,
      httpStatus: 400,
      body: {
        error: "Evidence packet incomplete",
        details: {
          hasCheckIn: !!evidence.gpsCheckInTimestamp,
          hasCheckOut: !!evidence.gpsCheckOutTimestamp,
          checklistComplete: evidence.isChecklistComplete,
          photoCount: evidence.photoUrls?.length || 0,
          status: evidence.status,
        },
      },
    };
  }

  // A completed, captured job has already been settled.
  if (job.status === "completed" && job.paymentStatus === "captured") {
    return {
      ok: true,
      httpStatus: 200,
      body: { message: "Payment already captured for this job" },
    };
  }

  // Derive late arrival from server-side timestamps.
  const serverArrival = evidence.gpsCheckInTimestamp
    ? evaluateArrival(job.checkInTime, evidence.gpsCheckInTimestamp)
    : null;
  const arrivalDelayMinutes =
    serverArrival?.delayMinutes ?? evidence.arrivalDelayMinutes;
  // Validate every v2 worker BEFORE any capture, reserve, payout or job update.
  // A missing adjustment policy must not leave partial financial execution.
  let contract: ReturnType<typeof readResidentialSnapshot>;
  try {
    contract = readResidentialSnapshot(job.addonsSnapshot);
  } catch {
    return {
      ok: false,
      httpStatus: 409,
      body: {
        error:
          "Residential pay terms require review before settlement. No new financial actions were taken.",
      },
    };
  }
  const v2Assignments =
    contract.kind === "v2"
      ? await db.query.jobsToCleaners.findMany({
          where: eq(jobsToCleaners.jobId, jobId),
          with: { cleaner: true },
        })
      : null;
  const v2Pay = new Map<string, ReturnType<typeof computeCleanerPay>>();
  if (v2Assignments) {
    try {
      const workers = v2Assignments.filter((a) => PAID_ROLES.has(a.role));
      if (workers.length !== job.addonsSnapshot?.residentialPricing?.teamSize)
        throw new Error("Incomplete v2 team");
      for (const a of workers)
        v2Pay.set(
          a.cleanerId,
          computeCleanerPay({
            residentialPricing: job.addonsSnapshot?.residentialPricing,
            assignmentTerms: a.residentialPayTerms,
            expectedHours: Number(job.expectedHours ?? 0),
            hourlyRateCents: a.frozenHourlyRateCents,
            role: a.role,
            urgentBonus: a.urgentBonus,
            arrivalDelayMinutes,
          }),
        );
    } catch {
      return {
        ok: false,
        httpStatus: 409,
        body: {
          error:
            "Residential pay terms require review before settlement. No new financial actions were taken.",
        },
      };
    }
  }

  // Update accountability fields without blocking settlement.
  afterCommit.push(() => reconcileEvidenceAccountability({ job, evidence }));

  // Prepaid jobs and skipped billing need no Stripe capture.
  const billingSkipped = isSkippedPaymentIntent(job.paymentIntentId);

  // Stripe decides whether the intent still needs capture.
  let alreadyCharged: Stripe.PaymentIntent | null = null;

  if (job.paymentIntentId && !billingSkipped) {
    const client = getStripe();
    if (!client) {
      return {
        ok: false,
        httpStatus: 503,
        body: { error: SERVICE_UNAVAILABLE.stripe },
      };
    }

    let intent: Stripe.PaymentIntent;
    try {
      intent = await client.paymentIntents.retrieve(job.paymentIntentId);
    } catch (lookupError) {
      const message =
        lookupError instanceof Error ? lookupError.message : "Unknown error";
      console.error("[capture-and-payout] intent lookup failed:", lookupError);
      await db
        .update(jobs)
        .set({
          paymentStatus: "capture_failed",
          notes: appendJobNote(
            job.notes,
            `[System] Could not read payment intent: ${message}`,
          ),
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, jobId));
      return {
        ok: false,
        httpStatus: 502,
        body: { error: "Could not read payment intent", details: message },
      };
    }

    if (intent.status === "succeeded") {
      // Charged up front; continue with reserve and payouts.
      alreadyCharged = intent;
    } else if (intent.status === "processing") {
      // Leave asynchronous settlement for the retry cron.
      return {
        ok: false,
        httpStatus: 409,
        body: {
          error: "Payment is still processing",
          details: "Capture will be retried once the intent settles.",
          jobId,
          retryable: true,
        },
      };
    } else if (intent.status !== "requires_capture") {
      // The customer did not complete payment.
      await db
        .update(jobs)
        .set({
          paymentStatus: "capture_failed",
          paymentFailed: true,
          notes: appendJobNote(
            job.notes,
            `[System] Capture not possible: payment intent is "${intent.status}".`,
          ),
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, jobId));
      return {
        ok: false,
        httpStatus: 402,
        body: {
          error: "Payment was never completed",
          details: `Payment intent is "${intent.status}".`,
          jobId,
        },
      };
    }
  }

  if (!job.paymentIntentId || billingSkipped) {
    await db
      .update(jobs)
      .set({
        paymentStatus: "captured",
        paymentFailed: false,
        notes: appendJobNote(
          job.notes,
          billingSkipped
            ? "[System] Billing skipped for this customer – no charge, marked as captured."
            : job.jobSource === "manual"
              ? // Manually created jobs were never charged.
                "[System] Manual job – no charge was due. Marked as captured so the cleaner is paid."
              : "[System] Prepaid during onboarding – marked as captured.",
        ),
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));

    const assignedCleaners =
      v2Assignments ??
      (await db.query.jobsToCleaners.findMany({
        where: eq(jobsToCleaners.jobId, jobId),
        with: { cleaner: true },
      }));

    const captureType = billingSkipped
      ? "skipped_billing"
      : job.jobSource === "manual"
        ? "manual_no_charge"
        : "prepaid";

    if (assignedCleaners.length === 0) {
      await db
        .update(jobs)
        .set({ status: "completed", updatedAt: new Date() })
        .where(eq(jobs.id, jobId));
      console.warn(`No cleaners assigned to non-charging job ${jobId}`);
      return {
        ok: true,
        httpStatus: 200,
        body: {
          success: true,
          type: captureType,
          message: "Job marked captured but no cleaners assigned",
          jobId,
          payoutsCreated: 0,
        },
      };
    }

    const expectedHours = parseFloat(job.expectedHours || "0");
    const workingCleaners = assignedCleaners.filter((a) =>
      PAID_ROLES.has(a.role),
    );

    // Insert sequentially; the production pooler cannot pipeline DB writes.
    for (const assignment of workingCleaners) {
      const pay =
        v2Pay.get(assignment.cleanerId) ??
        computeCleanerPay({
          residentialPricing: job.addonsSnapshot?.residentialPricing,
          assignmentTerms: assignment.residentialPayTerms,
          expectedHours,
          hourlyRateCents:
            assignment.frozenHourlyRateCents ??
            assignment.cleaner?.hourlyRateCents,
          role: assignment.role,
          laundryLoads: job.addonsSnapshot?.laundryLoads,
          urgentBonus: assignment.urgentBonus,
          arrivalDelayMinutes,
        });

      await db
        .insert(payouts)
        .values({
          jobId,
          cleanerId: assignment.cleanerId,
          amount: pay.total.toFixed(2),
          payReceipt: pay.receipt ?? null,
          urgentBonusAmount: pay.urgentBonus
            ? pay.urgentBonus.toFixed(2)
            : null,
          laundryBonusAmount: pay.laundryBonus
            ? pay.laundryBonus.toFixed(2)
            : null,
          lateDeductionAmount: pay.lateDeduction
            ? pay.lateDeduction.toFixed(2)
            : null,
          status: "pending",
        })
        // A cleaner can be paid once per job.
        .onConflictDoNothing({
          target: [payouts.jobId, payouts.cleanerId],
        });
    }

    await db
      .update(jobs)
      .set({ status: "completed", updatedAt: new Date() })
      .where(eq(jobs.id, jobId));

    afterCommit.push(() => emailCompletion(
      // Subscription-less jobs resolve through the property.
      job.subscription?.customer?.email ?? job.property?.customer?.email,
      job.subscription?.customer?.name ?? job.property?.customer?.name,
      job.property?.address,
      getJobDisplay(job).label,
    ));

    return {
      ok: true,
      httpStatus: 200,
      body: {
        success: true,
        type: captureType,
        message: billingSkipped
          ? "Billing skipped for this customer; payouts created"
          : job.jobSource === "manual"
            ? "Manual job: no charge was due; payouts created"
            : "Prepaid job marked captured and payouts created",
        jobId,
        payoutsCreated: workingCleaners.length,
      },
    };
  }

  // Captured and pre-authorized payments share the reserve and payout path.
  const stripe = getStripe();
  if (!stripe) {
    return { ok: false, httpStatus: 503, body: { error: SERVICE_UNAVAILABLE } };
  }

  let paymentIntent: Stripe.PaymentIntent;
  try {
    // A retry for this job must not capture twice.
    paymentIntent =
      alreadyCharged ??
      (await stripe.paymentIntents.capture(
        job.paymentIntentId,
        {},
        { idempotencyKey: `capture_${jobId}` },
      ));
  } catch (stripeError) {
    const message =
      stripeError instanceof Error ? stripeError.message : "Unknown error";
    console.error("Stripe capture failed:", stripeError);

    await db
      .update(jobs)
      .set({
        paymentStatus: "capture_failed",
        // Preserve prior reconciliation notes.
        notes: appendJobNote(job.notes, `[System] Capture failed: ${message}`),
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));

    return {
      ok: false,
      httpStatus: 500,
      body: { error: "Payment capture failed", details: message },
    };
  }

  // Validate provider money/refunds before any reserve or worker payout.
  const frozenAmount = contract.kind === "v1" || contract.kind === "v2"
    ? Number(contract.terms.amountChargedCents)
    : readRentalCharge(job.rentalCharge)?.chargeAmountCents;
  try { await verifySettledPayment(stripe, paymentIntent, frozenAmount ?? paymentIntent.amount); }
  catch { return { ok: false, httpStatus: 409, body: { error: "Payment amount, currency or refund state needs review before settlement." } }; }
  const capturedAmount = paymentIntent.amount_received;
  // Reserve rate accounts for recent dispute risk.
  const reserveRate = await computeReserveRate();
  const reserveAmount = Math.round(capturedAmount * reserveRate);
  const netAmount = capturedAmount - reserveAmount;

  // Ledger writes are safe to repeat after a partial failure.
  await db
      .insert(reserveTransactions)
      .values({
        jobId,
        paymentIntentId: job.paymentIntentId!,
        totalAmountCents: capturedAmount,
        reserveAmountCents: reserveAmount,
        netAmountCents: netAmount,
      })
      .onConflictDoNothing({ target: reserveTransactions.jobId });

  const assignedCleaners =
    v2Assignments ??
    (await db.query.jobsToCleaners.findMany({
      where: eq(jobsToCleaners.jobId, jobId),
      with: { cleaner: true },
    }));

  if (assignedCleaners.length === 0) {
    await db
      .update(jobs)
      .set({
        status: "completed",
        paymentStatus: "captured",
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
    console.warn(`No cleaners assigned to job ${jobId}`);
    return {
      ok: true,
      httpStatus: 200,
      body: {
        success: true,
        message: "Payment captured but no cleaners assigned",
        jobId,
        capturedAmount,
        reserveAmount,
        netAmount,
        paymentIntentId: paymentIntent.id,
        payoutsCreated: 0,
      },
    };
  }

  const expectedHours = parseFloat(job.expectedHours || "0");
  const workingCleaners = assignedCleaners.filter((a) =>
    PAID_ROLES.has(a.role),
  );

  // Insert sequentially; the production pooler cannot pipeline DB writes.
  for (const assignment of workingCleaners) {
    const pay =
      v2Pay.get(assignment.cleanerId) ??
      computeCleanerPay({
        residentialPricing: job.addonsSnapshot?.residentialPricing,
        assignmentTerms: assignment.residentialPayTerms,
        expectedHours,
        hourlyRateCents:
          assignment.frozenHourlyRateCents ??
          assignment.cleaner?.hourlyRateCents,
        role: assignment.role,
        laundryLoads: job.addonsSnapshot?.laundryLoads,
        urgentBonus: assignment.urgentBonus,
        arrivalDelayMinutes,
      });

    await db
      .insert(payouts)
      .values({
        jobId,
        cleanerId: assignment.cleanerId,
        amount: pay.total.toFixed(2),
        payReceipt: pay.receipt ?? null,
        urgentBonusAmount: pay.urgentBonus ? pay.urgentBonus.toFixed(2) : null,
        laundryBonusAmount: pay.laundryBonus
          ? pay.laundryBonus.toFixed(2)
          : null,
        lateDeductionAmount: pay.lateDeduction
          ? pay.lateDeduction.toFixed(2)
          : null,
        status: "pending",
      })
      // A cleaner can be paid once per job.
      .onConflictDoNothing({
        target: [payouts.jobId, payouts.cleanerId],
      });
  }

  await db
    .update(jobs)
    .set({
      status: "completed",
      paymentStatus: "captured",
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, jobId));

  afterCommit.push(() => emailCompletion(
    // Subscription-less jobs resolve through the property.
    job.subscription?.customer?.email ?? job.property?.customer?.email,
    job.subscription?.customer?.name ?? job.property?.customer?.name,
    job.property?.address,
    getJobDisplay(job).label,
  ));

  return {
    ok: true,
    httpStatus: 200,
    body: {
      success: true,
      type: alreadyCharged ? "prepaid_at_booking" : "stripe",
      message: alreadyCharged
        ? "Charged at booking; reserve recorded and payouts created"
        : "Payment captured and payouts created",
      jobId,
      capturedAmount,
      reserveAmount,
      netAmount,
      paymentIntentId: paymentIntent.id,
      payoutsCreated: workingCleaners.length,
    },
  };
}
