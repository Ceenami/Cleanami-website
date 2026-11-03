import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { jobs, properties, subscriptions, customers } from "@/db/schemas";
import { eq, and, isNull, gte, lt, ne } from "drizzle-orm";
import { PricingService } from "@/lib/services/pricing.service";
import { getStripe } from "@/lib/stripe/get-stripe";
import { SERVICE_UNAVAILABLE } from "@/lib/env/messages";
import { CancellationDetectionService } from "@/lib/services/cancellation-detection/cancellationDetection.service";
import { sendPaymentFailedEmail } from "@/lib/services/email.service";
import { assertCronAuth } from "@/lib/auth/cron-auth";
import { rentalQuoteRefusal } from "@/lib/pricing/rental-quote-refusal";
import {
  buildRentalCharge,
  readRentalCharge,
  rentalJobPricingInput,
  RentalPricingError,
} from "@/lib/pricing/rental-charge";
import { freezeRentalCharge } from "@/lib/services/payment/freeze-rental-charge";
import { authorizeRentalCharge } from "@/lib/services/payment/rental-authorization";
import { SKIPPED_PAYMENT_INTENT_ID } from "@/lib/billing/customer-billing";
import { appendJobNote } from "@/lib/jobs/job-notes";
import {
  resolvePromoCodeById,
  recordPromoRedemption,
} from "@/lib/services/promo-code.service";

const pricingService = new PricingService();

export async function POST(req: NextRequest) {
  const unauthorized = assertCronAuth(req);
  if (unauthorized) return unauthorized;

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: SERVICE_UNAVAILABLE }, { status: 503 });
  }

  console.log("=== CANCELLATION DETECTION ===");
  const cancellationService = new CancellationDetectionService(db);

  try {
    const cancellationResult =
      await cancellationService.detectCancellationsForAllSubscriptions();

    if (cancellationResult.success) {
      console.log(
        `✓ Cancellation detection completed: ${cancellationResult.totalJobsCancelled} jobs cancelled across ${cancellationResult.totalSubscriptions} subscriptions`
      );
    } else {
      console.error(
        `✗ Cancellation detection failed: ${cancellationResult.message}`
      );
    }
  } catch (cancellationError) {
    console.error(
      "Cancellation detection error (continuing with sync):",
      cancellationError
    );
  }

  const now = new Date();
  const tomorrowStart = new Date(now);
  tomorrowStart.setDate(now.getDate() + 1);
  tomorrowStart.setHours(0, 0, 0, 0);

  const dayAfterTomorrowStart = new Date(tomorrowStart);
  dayAfterTomorrowStart.setDate(tomorrowStart.getDate() + 1);

  console.log("=== PRE-AUTHORIZE CRON DEBUG ===");
  console.log("Current time:", now.toISOString());
  console.log("Tomorrow start:", tomorrowStart.toISOString());
  console.log("Day after tomorrow:", dayAfterTomorrowStart.toISOString());

  try {
    const jobsToProcess = await db
      .select({
        jobId: jobs.id,
        subscriptionId: jobs.subscriptionId,
        propertyData: properties,
        stripeCustomerId: customers.stripeCustomerId,
        checkOutTime: jobs.checkOutTime,
        addonsSnapshot: jobs.addonsSnapshot,
        rentalCharge: jobs.rentalCharge,
        // Existing notes, so the skip-payment branch can append rather than
        // clobber whatever seeding/reconciliation already recorded.
        notes: jobs.notes,
        // CHANGED: Added skipPayment to the selection
        skipPayment: customers.skipPayment,
        // Needed so the subscription-term discount applies to recurring cleans
        // too (not just the first clean).
        subscriptionMonths: subscriptions.durationMonths,
        // For a customer-applied promo code on this specific clean.
        customerId: subscriptions.customerId,
        customerEmail: customers.email,
      })
      .from(jobs)
      .innerJoin(subscriptions, eq(jobs.subscriptionId, subscriptions.id))
      .innerJoin(properties, eq(subscriptions.propertyId, properties.id))
      .innerJoin(customers, eq(subscriptions.customerId, customers.id))
      .where(
        and(
          gte(jobs.checkOutTime, tomorrowStart),
          lt(jobs.checkOutTime, dayAfterTomorrowStart),
          isNull(jobs.paymentIntentId),
          isNull(jobs.paymentStatus),
          ne(jobs.status, "canceled"),
          eq(subscriptions.status, "active")
        )
      );

    console.log("Jobs to process:", jobsToProcess.length);
    if (jobsToProcess.length > 0) {
      console.log(
        "Sample job checkout times:",
        jobsToProcess.slice(0, 3).map((j) => ({
          id: j.jobId,
          checkOutTime: j.checkOutTime,
        }))
      );
    }

    if (jobsToProcess.length === 0) {
      return NextResponse.json({
        message: "No jobs to process for tomorrow.",
        debug: {
          tomorrowRange: `${tomorrowStart.toISOString()} to ${dayAfterTomorrowStart.toISOString()}`,
        },
      });
    }

    // Each iteration performs database work. The production transaction
    // pooler drops pipelined queries, so this must stay sequential even though
    // Stripe calls could otherwise fan out in parallel.
    const results = [];
    for (const job of jobsToProcess) {
      const result = await (async () => {
      try {
        let charge = readRentalCharge(job.rentalCharge);
        if (!charge) {
          const pricingInput = rentalJobPricingInput(
            job.propertyData, job.subscriptionMonths, job.addonsSnapshot,
          );
          const priceDetails = await pricingService.calculatePrice(pricingInput);
          const refusal = rentalQuoteRefusal(priceDetails, pricingInput);
          if (refusal) throw new RentalPricingError(refusal);
          const candidate = buildRentalCharge(priceDetails, job.addonsSnapshot, job.skipPayment === true);
          let expectedPromoCodeId: string | null = null;

          // Read the current promo once, then freeze both its original amount
          // and final provider amount before authorizing. Term discounts are
          // already inside perCleanCents; the due drain is added afterward.
          if (!candidate.skippedPayment) {
            const freshJob = await db.query.jobs.findFirst({
              where: eq(jobs.id, job.jobId), columns: { promoCodeId: true },
            });
            expectedPromoCodeId = freshJob?.promoCodeId ?? null;
            if (freshJob?.promoCodeId) {
              const { evaluation } = await resolvePromoCodeById(
                freshJob.promoCodeId, candidate.amountCents, job.customerEmail,
              );
              if (evaluation.valid) {
                candidate.chargeAmountCents = evaluation.finalAmountCents;
                candidate.promo = {
                  promoCodeId: freshJob.promoCodeId, code: evaluation.code,
                  discountAmountCents: evaluation.discountCents,
                };
              } else {
                console.warn(`[pre-authorize] job ${job.jobId}: applied promo is no longer valid (${evaluation.reason}) — charging full price`);
              }
            }
          }
          charge = await freezeRentalCharge(db, job.jobId, candidate, expectedPromoCodeId);
          if (!charge) return { jobId: job.jobId, status: "already_processed" };
        }
        const amountInCents = charge.amountCents;
        const chargeAmountCents = charge.chargeAmountCents;
        const promoToRecord = charge.promo;

        if (charge.skippedPayment) {
          const skipped = await db.transaction(async (tx) => {
            const [current] = await tx.select().from(jobs)
              .where(eq(jobs.id, job.jobId)).for("update");
            if (!current || !["unassigned", "assigned"].includes(current.status ?? "") ||
                current.paymentIntentId || current.paymentStatus) return false;
            await tx.update(jobs).set({
              paymentIntentId: SKIPPED_PAYMENT_INTENT_ID,
              paymentStatus: "authorized",
              notes: appendJobNote(current.notes, `[System] Payment skipped (Owner/VIP). Value: $${(amountInCents / 100).toFixed(2)}`),
            }).where(eq(jobs.id, job.jobId));
            return true;
          });
          if (!skipped) return { jobId: job.jobId, status: "already_processed" };
          return { jobId: job.jobId, status: "skipped_payment" };
        }
        if (!job.stripeCustomerId)
          throw new Error(`Job ${job.jobId} is missing a Stripe Customer ID.`);

        const paymentIntent = await db.transaction(async (tx) => {
          const [current] = await tx.select().from(jobs)
            .where(eq(jobs.id, job.jobId)).for("update");
          // Cancellation holds this same lock through provider settlement.
          if (!current || !["unassigned", "assigned"].includes(current.status ?? "") ||
              current.paymentIntentId || current.paymentStatus) return null;
          const frozen = readRentalCharge(current.rentalCharge);
          if (!frozen || frozen.skippedPayment)
            throw new RentalPricingError("Rental authorization requires its frozen charge");
          const intent = await authorizeRentalCharge(stripe, job.jobId, job.stripeCustomerId!, frozen);
          await tx.update(jobs).set({ paymentIntentId: intent.id,
            paymentStatus: intent.status === "succeeded" ? "captured" : "authorized",
          }).where(eq(jobs.id, job.jobId));
          return intent;
        });
        if (!paymentIntent) return { jobId: job.jobId, status: "already_processed" };

        if (promoToRecord) {
          await recordPromoRedemption({
            promoCodeId: promoToRecord.promoCodeId,
            code: promoToRecord.code,
            customerEmail: job.customerEmail,
            customerId: job.customerId,
            subscriptionId: job.subscriptionId,
            jobId: job.jobId,
            paymentIntentId: paymentIntent.id,
            originalAmountCents: amountInCents,
            discountAmountCents: promoToRecord.discountAmountCents,
            finalAmountCents: chargeAmountCents,
          });
        }

        return { jobId: job.jobId, status: "success" };
      } catch (error: any) {
        console.error(`Failed to process job ${job.jobId}:`, error.message);
        const failed = await db
          .update(jobs)
          .set({
            paymentStatus: "failed",
            notes: appendJobNote(job.notes, error.message),
          })
          .where(and(eq(jobs.id, job.jobId), ne(jobs.status, "canceled"), isNull(jobs.paymentIntentId)))
          .returning({ id: jobs.id });
        if (!failed.length) return { jobId: job.jobId, status: "already_processed" };

        // A pricing/configuration refusal is an office review, not a declined
        // customer card. Persist the failure without sending a card-failure email.
        if (error instanceof RentalPricingError)
          return { jobId: job.jobId, status: "failed", error: error.message };

        // Notify the customer their payment failed (best-effort).
        try {
          const failedJob = await db.query.jobs.findFirst({
            where: eq(jobs.id, job.jobId),
            with: {
              subscription: { with: { customer: true } },
              property: true,
            },
          });
          if (failedJob?.subscription?.customer?.email) {
            await sendPaymentFailedEmail({
              to: failedJob.subscription.customer.email,
              name: failedJob.subscription.customer.name,
              propertyAddress: failedJob.property?.address ?? "your property",
            });
          }
        } catch (emailErr) {
          console.error("[pre-authorize] failed-payment email failed:", emailErr);
        }

        return { jobId: job.jobId, status: "failed", error: error.message };
      }
      })();
      results.push(result);
    }

    return NextResponse.json({
      message: "Pre-authorization process completed.",
      processedCount: results.length,
      results,
    });
  } catch (error: any) {
    console.error("Cron job failed:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 }
    );
  }
}
