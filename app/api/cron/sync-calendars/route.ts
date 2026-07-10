import { db } from "@/db";
import { subscriptions } from "@/db/schemas/subscriptions.schema";
import { eq } from "drizzle-orm";
import { ICalService } from "@/lib/services/iCal/ical.service";
import { CancellationDetectionService } from "@/lib/services/cancellation-detection/cancellationDetection.service";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
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

  console.log("Starting automated calendar sync for all active subscriptions");

  try {
    const activeSubscriptions = await db.query.subscriptions.findMany({
      where: eq(subscriptions.status, "active"),
      with: {
        property: true,
      },
    });

    console.log(
      `Found ${activeSubscriptions.length} active subscriptions to sync`
    );

    const icalService = new ICalService(db);
    const results = {
      total: activeSubscriptions.length,
      successful: 0,
      failed: 0,
      skipped: 0,
      errors: [] as Array<{ subscriptionId: string; error: string }>,
    };

    for (const subscription of activeSubscriptions) {
      try {
        if (!subscription.property?.iCalUrl) {
          console.log(`Skipping subscription ${subscription.id} - no iCal URL`);
          results.skipped++;
          continue;
        }

        console.log(`Syncing calendar for subscription ${subscription.id}`);

        const result = await icalService.syncCalendar({
          subscriptionId: subscription.id,
        });

        if (result.success) {
          results.successful++;
          console.log(
            `✓ Synced subscription ${subscription.id}: ${result.totalSynced} jobs`
          );

          await db
            .update(subscriptions)
            .set({
              iCalSyncFailed: false,
              lastSyncAttempt: new Date(),
            })
            .where(eq(subscriptions.id, subscription.id));
        } else {
          results.failed++;
          results.errors.push({
            subscriptionId: subscription.id,
            error: result.message || "Unknown error",
          });
          console.error(
            `✗ Failed to sync subscription ${subscription.id}: ${result.message}`
          );

          await db
            .update(subscriptions)
            .set({
              iCalSyncFailed: true,
              lastSyncAttempt: new Date(),
            })
            .where(eq(subscriptions.id, subscription.id));
        }
      } catch (error) {
        results.failed++;
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        results.errors.push({
          subscriptionId: subscription.id,
          error: errorMessage,
        });
        console.error(
          `✗ Exception syncing subscription ${subscription.id}:`,
          error
        );

        await db
          .update(subscriptions)
          .set({
            iCalSyncFailed: true,
            lastSyncAttempt: new Date(),
          })
          .where(eq(subscriptions.id, subscription.id));
      }
    }

    console.log("Sync completed:", results);

    // After the sync completes successfully, call the job assignment engine
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (supabaseUrl && supabaseAnonKey) {
  try {
    console.log("=== JOB ASSIGNMENT ENGINE ===");
    const assignmentResponse = await fetch(
      `${supabaseUrl}/functions/v1/job-assignment-engine`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${supabaseAnonKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    const assignmentResult = await assignmentResponse.json();

    if (assignmentResult.success) {
      console.log(
        `✓ Job assignment completed: ${assignmentResult.summary.assigned} assigned, ${assignmentResult.summary.skipped} skipped`
      );
    } else {
      console.error(`✗ Job assignment failed: ${assignmentResult.error}`);
    }
  } catch (assignmentError) {
    console.error("Job assignment error:", assignmentError);
  }

  console.log("=== JOB RECONCILIATION (stale active jobs) ===");
  try {
    const { reconcileStaleJobs } = await import(
      "@/lib/services/job-reconciliation.service"
    );
    const reconciliation = await reconcileStaleJobs();
    console.log("✓ Job reconciliation:", reconciliation);
  } catch (reconcileError) {
    console.error("Job reconciliation error:", reconcileError);
  }
}

    return new Response(
      JSON.stringify({
        success: true,
        message: `Synced ${results.successful} of ${results.total} calendars (${results.skipped} skipped)`,
        results,
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Fatal error in cron job:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: "Fatal error during sync",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
