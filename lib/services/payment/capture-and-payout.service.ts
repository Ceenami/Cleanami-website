import "server-only";

import { db } from "@/db";
import {
  jobs,
  evidencePackets,
  reserveTransactions,
  payouts,
  jobsToCleaners,
} from "@/db/schemas";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe/get-stripe";
import { SERVICE_UNAVAILABLE } from "@/lib/env/messages";
import { computeCleanerPay } from "@/lib/pricing/cleaner-pay";
import { computeReserveRate } from "@/lib/services/payment/reserve";
import { sendJobCompletionEmail } from "@/lib/services/email.service";
import { evaluateArrival } from "@/lib/services/gps/geofence";
import { reconcileEvidenceAccountability } from "@/lib/services/gps/reconcile-evidence";
import { isSkippedPaymentIntent } from "@/lib/billing/customer-billing";
import { appendJobNote } from "@/lib/jobs/job-notes";

/**
 * Roles that actually worked the job and are paid. Shadow backups (and unaccepted
 * on-call) are NOT paid unless they were promoted in, at which point their role
 * is changed to `primary`. Without this, a backup left on the job was paid full
 * pay for not working.
 */
const PAID_ROLES = new Set(["primary", "laundry_lead"]);

export type CaptureOutcome = {
  ok: boolean;
  httpStatus: number;
  body: Record<string, unknown>;
};

async function emailCompletion(
  customerEmail: string | null | undefined,
  customerName: string | null | undefined,
  propertyAddress: string | null | undefined
): Promise<void> {
  if (!customerEmail) return;
  try {
    await sendJobCompletionEmail({
      to: customerEmail,
      name: customerName ?? undefined,
      propertyAddress: propertyAddress ?? "your property",
    });
  } catch (err) {
    console.error("[capture-and-payout] completion email failed:", err);
  }
}

/**
 * Capture a completed job's payment (or mark a prepaid job captured), record the
 * 2% reserve, create cleaner payouts, and finalize the job as `completed`.
 *
 * Idempotent: a job already `captured` is a no-op, and payout inserts are
 * conflict-safe on `(jobId, cleanerId)`. Shared by the cleaner-app capture route
 * and the stranded-capture cron so no code path is left un-captured.
 */
export async function captureAndCreatePayouts(
  jobId: string
): Promise<CaptureOutcome> {
  const job = await db.query.jobs.findFirst({
    where: eq(jobs.id, jobId),
    with: {
      subscription: { with: { customer: true } },
      property: true,
    },
  });

  if (!job) {
    return { ok: false, httpStatus: 404, body: { error: "Job not found" } };
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

  // Idempotency: never re-capture or re-create payouts for a job this function
  // has already finished. This guards BOTH the prepaid and Stripe branches (2.2).
  //
  // `paymentStatus` alone is NOT sufficient evidence of that. The first clean of
  // a subscription is charged in full at booking, and onboarding writes
  // `paymentStatus: "captured"` at that moment (complete-onboarding.service.ts
  // :462) — long before a cleaner ever touches the job. Keying off it alone made
  // every first clean return here the moment the cleaner finished, leaving the
  // job at `awaiting_capture` with no payout row ever written. `status` only
  // becomes `completed` at the end of this function, so pairing the two is what
  // actually means "already settled". The payout insert is conflict-safe on
  // (jobId, cleanerId), so a second pass can never double-pay.
  if (job.status === "completed" && job.paymentStatus === "captured") {
    return {
      ok: true,
      httpStatus: 200,
      body: { message: "Payment already captured for this job" },
    };
  }

  // Derive arrival lateness server-side rather than trusting the value the
  // cleaner app wrote, which feeds the late-pay deduction below. Pure date math
  // — no I/O, so it always resolves; fall back to the stored value only when
  // there is no timestamp to compute from. See reconcileEvidenceAccountability
  // for the fuller (best-effort) recompute of the geofence flags + admin alert.
  const serverArrival = evidence.gpsCheckInTimestamp
    ? evaluateArrival(job.checkInTime, evidence.gpsCheckInTimestamp)
    : null;
  const arrivalDelayMinutes =
    serverArrival?.delayMinutes ?? evidence.arrivalDelayMinutes;

  // Overwrite the stored accountability fields with server-derived values and
  // flag out-of-geofence / late check-ins for admin review. Best-effort: this
  // never throws and never blocks capture.
  await reconcileEvidenceAccountability({ job, evidence });

  // ====================================================================
  // CASE 1: NOTHING TO CAPTURE — prepaid, or billing skipped for this customer
  // ====================================================================
  // The skip-billing sentinel is a truthy string, so testing `job.paymentIntentId`
  // for truthiness alone sent these jobs down the Stripe branch, where the capture
  // call failed against a non-existent intent. The job then stuck at
  // `capture_failed` and — the real damage — no payout row was ever written, so
  // the cleaner was never paid for work they had fully evidenced.
  const billingSkipped = isSkippedPaymentIntent(job.paymentIntentId);

  // Which settlement this job needs is decided by the intent's own status at
  // Stripe, never inferred from local columns. Capture is legal ONLY from
  // `requires_capture`; calling it in any other state errors out, so we ask
  // first rather than calling and catching.
  // https://docs.stripe.com/api/payment_intents/capture
  //
  // This is the point the first-clean bug turned on. That intent is created with
  // automatic capture (create-payment-intent.service.ts:299) and is therefore
  // already `succeeded` — money collected, nothing left to capture. It cannot
  // use manual capture instead, because a card authorization expires after ~7
  // days and the booking schema forces the first clean at least 7 days out. So
  // it is genuinely prepaid while still carrying a real intent id, and the old
  // `!job.paymentIntentId` test sent it to CASE 2, where capture failed.
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
            `[System] Could not read payment intent: ${message}`
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
      // Charged up front. Skip the capture call, keep everything downstream.
      alreadyCharged = intent;
    } else if (intent.status === "processing") {
      // Asynchronous settlement still in flight. Leave the job at
      // `awaiting_capture` and do NOT mark it failed — the stranded-capture
      // cron re-runs this function and will find a terminal status next time.
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
      // requires_payment_method / requires_confirmation / requires_action /
      // canceled — the customer never completed payment. Capture would throw a
      // generic 500; fail loudly with the actual reason instead.
      await db
        .update(jobs)
        .set({
          paymentStatus: "capture_failed",
          paymentFailed: true,
          notes: appendJobNote(
            job.notes,
            `[System] Capture not possible: payment intent is "${intent.status}".`
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
        status: "completed",
        paymentStatus: "captured",
        paymentFailed: false,
        notes: appendJobNote(
          job.notes,
          billingSkipped
            ? "[System] Billing skipped for this customer – no charge, marked as captured."
            : "[System] Prepaid during onboarding – marked as captured."
        ),
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));

    const assignedCleaners = await db.query.jobsToCleaners.findMany({
      where: eq(jobsToCleaners.jobId, jobId),
      with: { cleaner: true },
    });

    const captureType = billingSkipped ? "skipped_billing" : "prepaid";

    if (assignedCleaners.length === 0) {
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
      PAID_ROLES.has(a.role)
    );

    await Promise.all(
      workingCleaners.map((assignment) => {
        const pay = computeCleanerPay({
          expectedHours,
          hourlyRateCents: assignment.cleaner?.hourlyRateCents,
          role: assignment.role,
          laundryLoads: job.addonsSnapshot?.laundryLoads,
          urgentBonus: assignment.urgentBonus,
          arrivalDelayMinutes,
        });

        return db
          .insert(payouts)
          .values({
            jobId,
            cleanerId: assignment.cleanerId,
            amount: pay.total.toFixed(2),
            urgentBonusAmount: pay.urgentBonus ? pay.urgentBonus.toFixed(2) : null,
            laundryBonusAmount: pay.laundryBonus ? pay.laundryBonus.toFixed(2) : null,
            lateDeductionAmount: pay.lateDeduction
              ? pay.lateDeduction.toFixed(2)
              : null,
            status: "pending",
          })
          // Never duplicate a payout for the same (job, cleaner) (2.2).
          .onConflictDoNothing({
            target: [payouts.jobId, payouts.cleanerId],
          });
      })
    );

    await emailCompletion(
      job.subscription?.customer?.email,
      job.subscription?.customer?.name,
      job.property?.address
    );

    return {
      ok: true,
      httpStatus: 200,
      body: {
        success: true,
        type: captureType,
        message: billingSkipped
          ? "Billing skipped for this customer; payouts created"
          : "Prepaid job marked captured and payouts created",
        jobId,
        payoutsCreated: workingCleaners.length,
      },
    };
  }

  // ====================================================================
  // CASE 2: MONEY WAS COLLECTED — capture it now, or it was taken at booking
  // ====================================================================
  // Both paths converge here on purpose. A job charged up front still collected
  // real revenue, so it must record the 2% reserve and create payouts exactly
  // like a captured one; the only difference is that there is nothing to call
  // capture on. Routing it to CASE 1 instead would have paid the cleaner but
  // silently omitted the reserve ledger row for that revenue.
  const stripe = getStripe();
  if (!stripe) {
    return { ok: false, httpStatus: 503, body: { error: SERVICE_UNAVAILABLE } };
  }

  let paymentIntent: Stripe.PaymentIntent;
  try {
    // Deterministic idempotency key: a retried capture for the same job never
    // double-captures the customer (2.2).
    paymentIntent =
      alreadyCharged ??
      (await stripe.paymentIntents.capture(
        job.paymentIntentId,
        {},
        { idempotencyKey: `capture_${jobId}` }
      ));
  } catch (stripeError) {
    const message =
      stripeError instanceof Error ? stripeError.message : "Unknown error";
    console.error("Stripe capture failed:", stripeError);

    await db
      .update(jobs)
      .set({
        paymentStatus: "capture_failed",
        // Appended, not assigned: this used to overwrite the notes wholesale,
        // discarding reconciliation history and seed tags on the way past.
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

  // What was actually collected, not what was requested. Identical to `amount`
  // for a full capture, but it is the truthful figure for an intent that was
  // charged at booking, and it keeps the reserve math honest either way.
  const capturedAmount = paymentIntent.amount_received || paymentIntent.amount;
  // Reserve is normally 2%, auto-escalating to 5% when the 30-day dispute rate
  // exceeds 0.5% (spec §5/§20).
  const reserveRate = await computeReserveRate();
  const reserveAmount = Math.round(capturedAmount * reserveRate);
  const netAmount = capturedAmount - reserveAmount;

  // The Stripe capture above is idempotent, but everything after it must be too:
  // a crash between the capture and the job update leaves the money taken and
  // the job still marked uncaptured, so the next run repeats this block.
  //
  // Both writes go in one transaction, and the ledger insert no-ops if a row
  // for this job already exists (unique on job_id). Without that, a retry
  // inserted a second reserve row and double-counted the 2% hold.
  await db.transaction(async (tx) => {
    await tx
      .insert(reserveTransactions)
      .values({
        jobId,
        paymentIntentId: job.paymentIntentId!,
        totalAmountCents: capturedAmount,
        reserveAmountCents: reserveAmount,
        netAmountCents: netAmount,
      })
      .onConflictDoNothing({ target: reserveTransactions.jobId });

    await tx
      .update(jobs)
      .set({
        status: "completed",
        paymentStatus: "captured",
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
  });

  const assignedCleaners = await db.query.jobsToCleaners.findMany({
    where: eq(jobsToCleaners.jobId, jobId),
    with: { cleaner: true },
  });

  if (assignedCleaners.length === 0) {
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
    PAID_ROLES.has(a.role)
  );

  await Promise.all(
    workingCleaners.map((assignment) => {
      const pay = computeCleanerPay({
        expectedHours,
        hourlyRateCents: assignment.cleaner?.hourlyRateCents,
        role: assignment.role,
        laundryLoads: job.addonsSnapshot?.laundryLoads,
        urgentBonus: assignment.urgentBonus,
        arrivalDelayMinutes,
      });

      return db
        .insert(payouts)
        .values({
          jobId,
          cleanerId: assignment.cleanerId,
          amount: pay.total.toFixed(2),
          urgentBonusAmount: pay.urgentBonus ? pay.urgentBonus.toFixed(2) : null,
          laundryBonusAmount: pay.laundryBonus ? pay.laundryBonus.toFixed(2) : null,
          lateDeductionAmount: pay.lateDeduction
            ? pay.lateDeduction.toFixed(2)
            : null,
          status: "pending",
        })
        // Never duplicate a payout for the same (job, cleaner) (2.2).
        .onConflictDoNothing({
          target: [payouts.jobId, payouts.cleanerId],
        });
    })
  );

  await emailCompletion(
    job.subscription?.customer?.email,
    job.subscription?.customer?.name,
    job.property?.address
  );

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
