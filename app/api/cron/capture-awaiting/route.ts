import { db } from "@/db";
import { jobs } from "@/db/schemas";
import { eq } from "drizzle-orm";
import { assertCronAuth } from "@/lib/auth/cron-auth";
import { captureAndCreatePayouts } from "@/lib/services/payment/capture-and-payout.service";

export const runtime = "nodejs";

/**
 * Captures finished cleans that were left parked at `awaiting_capture` (e.g. by
 * the job-reconciliation service) and never captured — a revenue leak (2.9).
 * Jobs without complete evidence are skipped by the shared service. Fail-closed
 * on the cron secret. Schedule this a few times a day.
 */
export async function GET(request: Request) {
  const unauthorized = assertCronAuth(request);
  if (unauthorized) return unauthorized;

  const stranded = await db.query.jobs.findMany({
    where: eq(jobs.status, "awaiting_capture"),
    columns: { id: true },
  });

  const results: Array<{ jobId: string; ok: boolean; message?: string }> = [];
  let captured = 0;

  for (const job of stranded) {
    try {
      const outcome = await captureAndCreatePayouts(job.id);
      if (outcome.ok) captured += 1;
      results.push({
        jobId: job.id,
        ok: outcome.ok,
        message:
          typeof outcome.body.message === "string"
            ? outcome.body.message
            : typeof outcome.body.error === "string"
              ? outcome.body.error
              : undefined,
      });
    } catch (error) {
      results.push({
        jobId: job.id,
        ok: false,
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return Response.json({
    found: stranded.length,
    captured,
    results,
  });
}
