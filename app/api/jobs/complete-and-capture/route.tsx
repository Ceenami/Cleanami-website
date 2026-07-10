import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { jobs, evidencePackets, reserveTransactions, payouts, jobsToCleaners } from "@/db/schemas";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe/get-stripe";
import { SERVICE_UNAVAILABLE } from "@/lib/env/messages";
import { CLEANER_HOURLY_RATE } from "@/lib/pricing/staffing-logic";

export async function POST(req: NextRequest) {
  try {
    const apiKey = req.headers.get("x-api-key");
    
    if (!apiKey || apiKey !== process.env.CLEANER_APP_API_KEY) {
      return NextResponse.json(
        { error: "Unauthorized: Invalid or missing API key" },
        { status: 401 }
      );
    }

    const { jobId } = await req.json();

    if (!jobId) {
      return NextResponse.json({ error: "Job ID is required" }, { status: 400 });
    }

    const job = await db.query.jobs.findFirst({
      where: eq(jobs.id, jobId),
      with: {
        subscription: {
          with: {
            customer: true,
          },
        },
        property: true,
      },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const evidence = await db.query.evidencePackets.findFirst({
      where: eq(evidencePackets.jobId, jobId),
    });

    if (!evidence) {
      return NextResponse.json(
        { error: "Evidence packet not found. Job cannot be completed." },
        { status: 400 }
      );
    }

    const isEvidenceComplete =
      evidence.status === "complete" &&
      evidence.gpsCheckInTimestamp &&
      evidence.gpsCheckOutTimestamp &&
      evidence.isChecklistComplete &&
      evidence.photoUrls &&
      evidence.photoUrls.length > 0;

    if (!isEvidenceComplete) {
      return NextResponse.json(
        {
          error: "Evidence packet incomplete",
          details: {
            hasCheckIn: !!evidence.gpsCheckInTimestamp,
            hasCheckOut: !!evidence.gpsCheckOutTimestamp,
            checklistComplete: evidence.isChecklistComplete,
            photoCount: evidence.photoUrls?.length || 0,
            status: evidence.status,
          },
        },
        { status: 400 }
      );
    }

    // ====================================================================
    // CASE 1: PREPAID JOB — No paymentIntentId
    // ====================================================================
    if (!job.paymentIntentId) {
      console.log(`💳 Job ${job.id} is prepaid — skipping Stripe capture`);

      await db
        .update(jobs)
        .set({
          paymentStatus: "captured",
          paymentFailed: false,
          notes: job.notes
            ? `${job.notes}\n[System] Prepaid during onboarding – marked as captured.`
            : "[System] Prepaid during onboarding – marked as captured.",
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, jobId));

      const assignedCleaners = await db.query.jobsToCleaners.findMany({
        where: eq(jobsToCleaners.jobId, jobId),
        with: { cleaner: true },
      });

      if (assignedCleaners.length === 0) {
        console.warn(`No cleaners assigned to prepaid job ${jobId}`);
        return NextResponse.json({
          success: true,
          type: "prepaid",
          message: "Prepaid job marked captured but no cleaners assigned",
          jobId: jobId,
          payoutsCreated: 0,
        });
      }

      const expectedHours = parseFloat(job.expectedHours || "0");
      const basePayPerCleaner = expectedHours * CLEANER_HOURLY_RATE;

      const payoutPromises = assignedCleaners.map(async (assignment) => {
        let totalPayout = basePayPerCleaner;
        let laundryBonus: number | null = null;
        let urgentBonus: number | null = null;

        if (assignment.role === "laundry_lead" && job.addonsSnapshot?.laundryLoads) {
          laundryBonus = job.addonsSnapshot.laundryLoads * 5;
          totalPayout += laundryBonus;
        }

        if (assignment.urgentBonus) {
          urgentBonus = 10;
          totalPayout += urgentBonus;
        }

        return db.insert(payouts).values({
          jobId: jobId,
          cleanerId: assignment.cleanerId,
          amount: totalPayout.toFixed(2),
          urgentBonusAmount: urgentBonus ? urgentBonus.toFixed(2) : null,
          laundryBonusAmount: laundryBonus ? laundryBonus.toFixed(2) : null,
          status: "pending",
        });
      });

      await Promise.all(payoutPromises);

      return NextResponse.json({
        success: true,
        type: "prepaid",
        message: "Prepaid job marked captured and payouts created",
        jobId: jobId,
        payoutsCreated: assignedCleaners.length,
      });
    }

    // ====================================================================
    // CASE 2: NORMAL STRIPE PAYMENT INTENT FLOW
    // ====================================================================
    if (job.paymentStatus === "captured") {
      return NextResponse.json(
        { message: "Payment already captured for this job" },
        { status: 200 }
      );
    }

    let paymentIntent: Stripe.PaymentIntent;

    const stripe = getStripe();
    if (!stripe) {
      return NextResponse.json({ error: SERVICE_UNAVAILABLE }, { status: 503 });
    }
    
    try {
      paymentIntent = await stripe.paymentIntents.capture(job.paymentIntentId);
    } catch (stripeError: any) {
      console.error("Stripe capture failed:", stripeError);
      
      await db
        .update(jobs)
        .set({
          paymentStatus: "capture_failed",
          notes: `Capture failed: ${stripeError.message}`,
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, jobId));

      return NextResponse.json(
        { error: "Payment capture failed", details: stripeError.message },
        { status: 500 }
      );
    }

    const capturedAmount = paymentIntent.amount;
    const reserveAmount = Math.round(capturedAmount * 0.02);
    const netAmount = capturedAmount - reserveAmount;

    await db.insert(reserveTransactions).values({
      jobId: jobId,
      paymentIntentId: job.paymentIntentId,
      totalAmountCents: capturedAmount,
      reserveAmountCents: reserveAmount,
      netAmountCents: netAmount,
    });

    await db
      .update(jobs)
      .set({
        paymentStatus: "captured",
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));

    const assignedCleaners = await db.query.jobsToCleaners.findMany({
      where: eq(jobsToCleaners.jobId, jobId),
      with: { cleaner: true },
    });

    if (assignedCleaners.length === 0) {
      console.warn(`No cleaners assigned to job ${jobId}`);
      return NextResponse.json({
        success: true,
        message: "Payment captured but no cleaners assigned",
        jobId: jobId,
        capturedAmount,
        reserveAmount,
        netAmount,
        paymentIntentId: paymentIntent.id,
        payoutsCreated: 0,
      });
    }

    const expectedHours = parseFloat(job.expectedHours || "0");
    const basePayPerCleaner = expectedHours * CLEANER_HOURLY_RATE;

    const payoutPromises = assignedCleaners.map(async (assignment) => {
      let totalPayout = basePayPerCleaner;
      let laundryBonus: number | null = null;
      let urgentBonus: number | null = null;

      if (assignment.role === "laundry_lead" && job.addonsSnapshot?.laundryLoads) {
        laundryBonus = job.addonsSnapshot.laundryLoads * 5;
        totalPayout += laundryBonus;
      }

      if (assignment.urgentBonus) {
        urgentBonus = 10;
        totalPayout += urgentBonus;
      }

      return db.insert(payouts).values({
        jobId: jobId,
        cleanerId: assignment.cleanerId,
        amount: totalPayout.toFixed(2),
        urgentBonusAmount: urgentBonus ? urgentBonus.toFixed(2) : null,
        laundryBonusAmount: laundryBonus ? laundryBonus.toFixed(2) : null,
        status: "pending",
      });
    });

    await Promise.all(payoutPromises);

    return NextResponse.json({
      success: true,
      type: "stripe",
      message: "Payment captured and payouts created",
      jobId: jobId,
      capturedAmount,
      reserveAmount,
      netAmount,
      paymentIntentId: paymentIntent.id,
      payoutsCreated: assignedCleaners.length,
    });

  } catch (error: any) {
    console.error("Job completion capture failed:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 }
    );
  }
}


// =============================================================================
// SETUP INSTRUCTIONS
// =============================================================================

/*
1. Generate a secure API key:
   Run in terminal:
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

2. Add to your .env file:
   CLEANER_APP_API_KEY=your_generated_key_here

3. Store the same key in your cleaner app's environment variables
*/

// =============================================================================
// CLEANER APP INTEGRATION
// =============================================================================

/*
In your cleaner mobile app, call this endpoint after job completion:

Example using fetch:

const completeJob = async (jobId: string) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/jobs/complete-and-capture`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.CLEANER_APP_API_KEY, // Stored in app config
      },
      body: JSON.stringify({ jobId }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Failed to complete job');
    }

    return result;
  } catch (error) {
    console.error('Error completing job:', error);
    throw error;
  }
};

Example usage in cleaner app flow:

1. Cleaner uploads all photos → evidencePackets.photoUrls populated
2. Cleaner completes checklist → evidencePackets.isChecklistComplete = true
3. Cleaner GPS checks out → evidencePackets.gpsCheckOutTimestamp set
4. App updates evidencePackets.status = 'complete'
5. App calls: await completeJob(jobId)
6. Success response triggers cleaner notification: "Job complete! Payment processed."
*/

// =============================================================================
// SECURITY NOTES
// =============================================================================

/*
✅ API Key stored in environment variables (not hardcoded)
✅ Key should be rotated periodically (every 6-12 months)
✅ Evidence packet validation prevents premature capture
✅ Only jobs with complete evidence can be captured
✅ Job status prevents double-capture
✅ All failures logged for admin review

⚠️ Important:
- Never commit .env file to version control
- Store API key securely in cleaner app (use secure storage like react-native-keychain)
- Consider rate limiting this endpoint if needed (e.g., max 100 requests/min per IP)
*/

// =============================================================================
// HOW TO TRIGGER THIS ENDPOINT
// =============================================================================

/*
In your cleaner app, when a job is completed:

1. Cleaner uploads photos → stored in evidencePackets.photoUrls
2. Cleaner completes checklist → evidencePackets.isChecklistComplete = true
3. Cleaner GPS checks out → evidencePackets.gpsCheckOutTimestamp set
4. App updates evidencePackets.status = 'complete'
5. App calls: POST /api/jobs/complete-and-capture
   Body: { "jobId": "uuid-here" }

This endpoint will:
✅ Verify all evidence is complete
✅ Capture the pre-authorized payment from customer
✅ Calculate and track 2% reserve
✅ Mark job as captured
✅ Create payout records for all assigned cleaners with bonuses
✅ Payouts are now ready for Stripe Connect transfers (separate process)
*/

// =============================================================================
// PAYOUT SCHEMA - MATCHES YOUR EXISTING SCHEMA
// =============================================================================

/*
✅ Your payouts schema uses numeric (decimal) fields:

- amount: Total payout amount in dollars (e.g., "85.00")
- urgentBonusAmount: $10 bonus if urgent (e.g., "10.00")
- laundryBonusAmount: $5/load bonus if laundry lead (e.g., "15.00" for 3 loads)
- status: 'pending', 'released', or 'held'

The amount field stores: base pay + urgent bonus + laundry bonus
Example: 4 hours * $17/hr = $68.00 base + $10 urgent = $78.00 total

Next step: Create a separate endpoint or cron to process pending payouts
via Stripe Connect transfers and update status to 'released'
*/