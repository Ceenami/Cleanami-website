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
import { buildRecurringPricingInput } from "@/lib/pricing/recurring-pricing-input";
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

    const processingPromises = jobsToProcess.map(async (job) => {
      try {
        // Transform property data to match pricing service's expected format
        const pricingInput = buildRecurringPricingInput(
          job.propertyData,
          job.subscriptionMonths
        );

        const priceDetails = await pricingService.calculatePrice(
          pricingInput as any
        );
        const amountInCents = Math.round(priceDetails.totalPerClean * 100);

        console.log(
          `Job ${job.jobId}: Calculated price $${priceDetails.totalPerClean} (${amountInCents} cents)`
        );

        // CHANGED: Logic to skip payment for specific owners/customers
        if (job.skipPayment) {
          console.log(
            `Job ${job.jobId}: Customer marked for skip_payment. Bypassing Stripe.`
          );

          // We mark it as "authorized" so the system treats it as a valid job,
          // but we use a specialized ID so you know no money was moved. Capture
          // recognises that sentinel and pays the cleaner without calling Stripe
          // (see isSkippedPaymentIntent) — do not swap it for a truthy stand-in.
          await db
            .update(jobs)
            .set({
              paymentIntentId: SKIPPED_PAYMENT_INTENT_ID,
              paymentStatus: "authorized",
              notes: appendJobNote(
                job.notes,
                `[System] Payment skipped (Owner/VIP). Value: $${priceDetails.totalPerClean}`
              ),
            })
            .where(eq(jobs.id, job.jobId));

          return { jobId: job.jobId, status: "skipped_payment" };
        }

        // --- Standard Stripe Flow ---

        if (!job.stripeCustomerId) {
          throw new Error(`Job ${job.jobId} is missing a Stripe Customer ID.`);
        }

        // Stripe minimum charge is 50 cents for USD. Checked against the full,
        // undiscounted price — a promo code must never mask a misconfigured
        // property by pushing a pre-discount amount under this floor.
        if (amountInCents < 50) {
          throw new Error(
            `Calculated amount ($${priceDetails.totalPerClean}) is below Stripe's minimum charge of $0.50. Check property pricing configuration.`
          );
        }

        // Customer-applied promo code for this specific clean (task:
        // customer-entered promo codes on upcoming cleans). Re-read fresh
        // here, right before charging, rather than trusting only the earlier
        // batch SELECT, to shrink the window between a customer applying/
        // removing a code and this cron actually processing the job.
        let chargeAmountCents = amountInCents;
        let promoToRecord: {
          promoCodeId: string;
          code: string;
          discountAmountCents: number;
          finalAmountCents: number;
        } | null = null;

        const freshJob = await db.query.jobs.findFirst({
          where: eq(jobs.id, job.jobId),
          columns: { promoCodeId: true },
        });

        if (freshJob?.promoCodeId) {
          const { evaluation } = await resolvePromoCodeById(
            freshJob.promoCodeId,
            amountInCents,
            job.customerEmail
          );

          if (evaluation.valid) {
            chargeAmountCents = evaluation.finalAmountCents;
            promoToRecord = {
              promoCodeId: freshJob.promoCodeId,
              code: evaluation.code,
              discountAmountCents: evaluation.discountCents,
              finalAmountCents: evaluation.finalAmountCents,
            };
          } else {
            // Fail OPEN on the discount, never on the charge: a stale promo
            // application (deactivated/expired/exhausted since applied) must
            // not block a real clean from being paid for.
            console.warn(
              `[pre-authorize] job ${job.jobId}: applied promo code no longer valid (${evaluation.reason}) — charging full price`
            );
          }
        }

        const paymentMethods = await stripe.paymentMethods.list({
          customer: job.stripeCustomerId,
          type: "card",
        });

        if (paymentMethods.data.length === 0) {
          throw new Error(
            `No saved payment method found for customer ${job.stripeCustomerId}`
          );
        }
        const paymentMethodId = paymentMethods.data[0].id;

        const paymentIntent = await stripe.paymentIntents.create(
          {
            amount: chargeAmountCents,
            currency: "usd",
            customer: job.stripeCustomerId,
            payment_method: paymentMethodId,
            capture_method: "manual",
            confirm: true,
            automatic_payment_methods: {
              enabled: true,
              allow_redirects: "never",
            },
            metadata: { jobId: job.jobId },
          },
          // Deterministic key: a retried pre-authorize for the same job never
          // creates a second authorization / hold (2.2).
          { idempotencyKey: `preauth_${job.jobId}` }
        );

        await db
          .update(jobs)
          .set({
            paymentIntentId: paymentIntent.id,
            paymentStatus: "authorized",
          })
          .where(eq(jobs.id, job.jobId));

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
            finalAmountCents: promoToRecord.finalAmountCents,
          });
        }

        return { jobId: job.jobId, status: "success" };
      } catch (error: any) {
        console.error(`Failed to process job ${job.jobId}:`, error.message);
        await db
          .update(jobs)
          .set({
            paymentStatus: "failed",
            notes: error.message,
          })
          .where(eq(jobs.id, job.jobId));

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
    });

    const results = await Promise.all(processingPromises);

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