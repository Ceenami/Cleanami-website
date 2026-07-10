import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { jobs, properties, subscriptions, customers } from "@/db/schemas";
import { eq, and, isNull, gte, lt, ne } from "drizzle-orm";
import { PricingService } from "@/lib/services/pricing.service";
import { getStripe } from "@/lib/stripe/get-stripe";
import { SERVICE_UNAVAILABLE } from "@/lib/env/messages";
import { CancellationDetectionService } from "@/lib/services/cancellation-detection/cancellationDetection.service";

const pricingService = new PricingService();

export async function POST(req: NextRequest) {
  const authToken = (req.headers.get("authorization") || "").split(
    "Bearer "
  )[1];
  if (authToken !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
        propertyData: properties,
        stripeCustomerId: customers.stripeCustomerId,
        checkOutTime: jobs.checkOutTime,
        // CHANGED: Added skipPayment to the selection
        skipPayment: customers.skipPayment,
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
        const pricingInput = {
          bedrooms: job.propertyData.bedCount,
          bathrooms: Number(job.propertyData.bathCount),
          sqft: job.propertyData.sqFt || 0,
          laundryService: job.propertyData.laundryType,
          laundryLoads: job.propertyData.laundryLoads,
          hasHotTub: job.propertyData.hasHotTub,
          hotTubService: job.propertyData.hotTubServiceLevel,
          hotTubDrain: job.propertyData.hotTubDrain,
          hotTubDrainCadence: job.propertyData.hotTubDrainCadence,
        };

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
          // but we use a specialized ID so you know no money was moved.
          await db
            .update(jobs)
            .set({
              paymentIntentId: "skipped_owner_payment",
              paymentStatus: "authorized",
              notes: `Payment skipped (Owner/VIP). Value: $${priceDetails.totalPerClean}`,
            })
            .where(eq(jobs.id, job.jobId));

          return { jobId: job.jobId, status: "skipped_payment" };
        }

        // --- Standard Stripe Flow ---

        if (!job.stripeCustomerId) {
          throw new Error(`Job ${job.jobId} is missing a Stripe Customer ID.`);
        }

        // Stripe minimum charge is 50 cents for USD
        if (amountInCents < 50) {
          throw new Error(
            `Calculated amount ($${priceDetails.totalPerClean}) is below Stripe's minimum charge of $0.50. Check property pricing configuration.`
          );
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

        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountInCents,
          currency: "usd",
          customer: job.stripeCustomerId,
          payment_method: paymentMethodId,
          capture_method: "manual",
          confirm: true,
          automatic_payment_methods: {
            enabled: true,
            allow_redirects: "never",
          },
        });

        await db
          .update(jobs)
          .set({
            paymentIntentId: paymentIntent.id,
            paymentStatus: "authorized",
          })
          .where(eq(jobs.id, job.jobId));

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