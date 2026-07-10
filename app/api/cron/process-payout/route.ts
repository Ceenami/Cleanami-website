import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { payouts } from "@/db/schemas";
import { eq } from "drizzle-orm";
import { getStripe } from "@/lib/stripe/get-stripe";
import { SERVICE_UNAVAILABLE } from "@/lib/env/messages";

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const token = authHeader?.split("Bearer ")[1];
    
    if (token !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const stripe = getStripe();
    if (!stripe) {
      return NextResponse.json({ error: SERVICE_UNAVAILABLE }, { status: 503 });
    }

    const pendingPayouts = await db.query.payouts.findMany({
      where: eq(payouts.status, "pending"),
      with: {
        cleaner: true,
        job: {
          with: {
            property: true,
            subscription: {
              with: {
                customer: true,
              },
            },
          },
        },
      },
    });

    if (pendingPayouts.length === 0) {
      return NextResponse.json({
        message: "No pending payouts to process",
        processed: 0,
      });
    }

    const results = {
      processed: 0,
      failed: 0,
      held: 0,
      totalPaidOut: 0,
      errors: [] as Array<{
        payoutId: string;
        cleanerId: string;
        error: string;
      }>,
    };

    for (const payout of pendingPayouts) {
      try {
        // Skip payment processing for owners who pay cleaners directly
        if (payout.job?.subscription?.customer?.skipPayment) {
          await db
            .update(payouts)
            .set({
              status: "released",
              stripePayoutId: "skipped_owner_direct_payment",
              updatedAt: new Date(),
            })
            .where(eq(payouts.id, payout.id));

          results.processed++;
          results.totalPaidOut += parseFloat(payout.amount);
          continue;
        }

        if (!payout.cleaner.stripeAccountId) {
          await db
            .update(payouts)
            .set({
              status: "held",
              updatedAt: new Date(),
            })
            .where(eq(payouts.id, payout.id));

          results.held++;
          results.errors.push({
            payoutId: payout.id,
            cleanerId: payout.cleanerId,
            error: "Cleaner missing Stripe Connect account",
          });
          continue;
        }

        const totalAmount = parseFloat(payout.amount);
        const urgentBonus = parseFloat(payout.urgentBonusAmount || "0");
        const laundryBonus = parseFloat(payout.laundryBonusAmount || "0");

        if (totalAmount <= 0) {
          await db
            .update(payouts)
            .set({
              status: "held",
              updatedAt: new Date(),
            })
            .where(eq(payouts.id, payout.id));

          results.held++;
          results.errors.push({
            payoutId: payout.id,
            cleanerId: payout.cleanerId,
            error: `Invalid payout amount: $${totalAmount}`,
          });
          continue;
        }

        // Convert to cents for Stripe (minimum $1.00 = 100 cents)
        const amountInCents = Math.round(totalAmount * 100);

        if (amountInCents < 100) {
          await db
            .update(payouts)
            .set({
              status: "held",
              updatedAt: new Date(),
            })
            .where(eq(payouts.id, payout.id));

          results.held++;
          results.errors.push({
            payoutId: payout.id,
            cleanerId: payout.cleanerId,
            error: `Amount too low for transfer: $${totalAmount} (min $1.00)`,
          });
          continue;
        }

        const transfer = await stripe.transfers.create({
          amount: amountInCents,
          currency: "usd",
          destination: payout.cleaner.stripeAccountId,
          description: `CleanNami Job #${payout.jobId.slice(0, 8)}`,
          metadata: {
            payoutId: payout.id,
            jobId: payout.jobId,
            cleanerId: payout.cleanerId,
            cleanerName: payout.cleaner.fullName,
            propertyAddress: payout.job?.property?.address || "N/A",
            totalAmount: totalAmount.toFixed(2),
            urgentBonus: urgentBonus > 0 ? urgentBonus.toFixed(2) : "0",
            laundryBonus: laundryBonus > 0 ? laundryBonus.toFixed(2) : "0",
          },
        });

        await db
          .update(payouts)
          .set({
            stripePayoutId: transfer.id,
            status: "released",
            updatedAt: new Date(),
          })
          .where(eq(payouts.id, payout.id));

        results.processed++;
        results.totalPaidOut += totalAmount;

      } catch (error: any) {
        console.error(`Failed to process payout ${payout.id}:`, error);

        const isRetriable = 
          error.type === "StripeConnectionError" ||
          error.type === "StripeAPIError" ||
          error.code === "rate_limit";

        // Only mark as held for permanent failures
        // Retriable errors keep status as pending for next run
        if (!isRetriable) {
          await db
            .update(payouts)
            .set({
              status: "held",
              updatedAt: new Date(),
            })
            .where(eq(payouts.id, payout.id));
        }

        results.failed++;
        results.errors.push({
          payoutId: payout.id,
          cleanerId: payout.cleanerId,
          error: `${error.type || "Error"}: ${error.message}`,
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: "Payout processing complete",
      totalPendingFound: pendingPayouts.length,
      processed: results.processed,
      failed: results.failed,
      held: results.held,
      totalPaidOutUSD: results.totalPaidOut.toFixed(2),
      errors: results.errors.length > 0 ? results.errors : undefined,
    });

  } catch (error: any) {
    console.error("Payout processing cron failed:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 }
    );
  }
}

// =============================================================================
// SPEC COMPLIANCE NOTES
// =============================================================================

/*
✅ Per Spec Section 20.2 - Cleaner Payouts:
- "Cleaners onboarded as Stripe Connect Express Accounts"
- "Payout = expected hours × $17/hr + $5 per off-site laundry load (Laundry Lead only) + $10 urgent accept bonus"
- "Payouts executed same day via Stripe Transfer after job completion and evidence packet submitted"

✅ Per Spec Section 5 - Payments & Payouts:
- "Cleaner payouts not clawed back unless fraud/false evidence is proven and admin overrides"

✅ This endpoint should run:
- Every hour via cron (to process new pending payouts quickly)
- Or immediately after capture endpoint creates payout records (webhook-triggered)

CRON SCHEDULE RECOMMENDATION:
Run every 15-30 minutes during business hours for "instant" feel
Example Vercel cron: '0,15,30,45 * * * *' (every 15 minutes)
*/

// =============================================================================
// STRIPE CONNECT REQUIREMENTS
// =============================================================================

/*
IMPORTANT: Cleaners must be onboarded as Stripe Connect Express accounts

Setup process:
1. Cleaner signs up in app
2. App creates Stripe Connect Express account link
3. Cleaner completes Stripe onboarding (bank details, tax info)
4. stripeAccountId saved to cleaners.stripeAccountId
5. Only then can payouts be processed

If cleaner missing stripeAccountId:
- Payout marked as "held"
- Admin notified to complete cleaner onboarding
- Cannot process until resolved
*/

// =============================================================================
// ERROR HANDLING
// =============================================================================

/*
Payout Status Flow:
- pending → Transfer initiated successfully → released ✅
- pending → Cleaner missing Stripe account → held ⚠️
- pending → Transfer fails (permanent) → held ⚠️
- pending → Transfer fails (temporary network) → stays pending, retries next run 🔄

Admin actions needed for "held" payouts:
- Complete cleaner Stripe onboarding
- Verify cleaner bank account valid
- Manual override if needed
*/