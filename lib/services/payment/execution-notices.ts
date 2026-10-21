import "server-only";
import { db } from "@/db";
import { jobs } from "@/db/schemas";
import { eq } from "drizzle-orm";
import {
  sendCancellationEmail,
  sendJobCompletionEmail,
} from "@/lib/services/email.service";

/** Best-effort existing customer notices, after the new financial transaction commits. */
export async function sendExecutionNotice(
  jobId: string,
  kind: "completed" | "canceled",
  detail?: string,
) {
  try {
    const job = await db.query.jobs.findFirst({
      where: eq(jobs.id, jobId),
      with: { property: { with: { customer: true } } },
    });
    const customer = job?.property?.customer;
    if (!customer?.email) return;
    const recipient = {
      to: customer.email,
      name: customer.name,
      propertyAddress: job!.property!.address,
    };
    if (kind === "completed") await sendJobCompletionEmail(recipient);
    else
      await sendCancellationEmail({
        ...recipient,
        detail: detail ?? "Your clean was canceled.",
      });
  } catch {
    // A messaging outage never repeats a charge, payout or cancellation.
    console.warn("[job-execution] Customer notice unavailable", {
      jobId,
      kind,
    });
  }
}
