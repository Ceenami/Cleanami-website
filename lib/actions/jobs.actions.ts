"use server";

import { createClient } from "@/lib/supabase/server";
import { getDbOrNull } from "@/db";
import { jobs } from "@/db/schemas";
import { eq } from "drizzle-orm";
import { getStripe } from "@/lib/stripe/get-stripe";
import { SERVICE_UNAVAILABLE } from "@/lib/env/messages";

export async function capturePaymentForJob(jobId: string): Promise<{
  success: boolean;
  message: string;
}> {
  const stripe = getStripe();
  if (!stripe) {
    return { success: false, message: SERVICE_UNAVAILABLE.stripe };
  }

  const db = getDbOrNull();
  if (!db) {
    return { success: false, message: SERVICE_UNAVAILABLE.database };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, message: "Unauthorized." };
  }

  const job = await db.query.jobs.findFirst({
    where: eq(jobs.id, jobId),
  });

  if (!job) {
    return { success: false, message: `Job with ID ${jobId} not found.` };
  }

  if (!job.paymentIntentId) {
    return {
      success: false,
      message: "This job has no associated Payment Intent. Pre-authorization may have failed.",
    };
  }

  if (job.paymentStatus !== "authorized") {
    return {
      success: false,
      message: `Payment cannot be captured. Job status is '${job.paymentStatus}', not 'authorized'.`,
    };
  }

  try {
    await stripe.paymentIntents.capture(job.paymentIntentId);

    await db
      .update(jobs)
      .set({
        paymentStatus: "captured",
        status: "completed", 
      })
      .where(eq(jobs.id, jobId));

    return { success: true, message: "Payment captured successfully." };
    
  } catch (error: any) {
    console.error(`Failed to capture payment for job ${jobId}:`, error);
    const errorMessage = error.message || "An unknown error occurred during capture.";

    await db
      .update(jobs)
      .set({
        paymentStatus: "capture_failed",
        notes: `Capture Failed: ${errorMessage}`,
      })
      .where(eq(jobs.id, jobId));

    return { success: false, message: `Payment capture failed: ${errorMessage}` };
  }
}