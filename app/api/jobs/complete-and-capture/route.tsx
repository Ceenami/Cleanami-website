import { NextRequest, NextResponse } from "next/server";
import { captureAndCreatePayouts } from "@/lib/services/payment/capture-and-payout.service";

export const runtime = "nodejs";

/**
 * Cleaner-app capture trigger. Authenticated by a shared API key (fail-closed if
 * the key is unset). The capture + payout logic lives in the shared service so
 * the stranded-capture cron can drive the exact same flow.
 */
export async function POST(req: NextRequest) {
  try {
    const expectedKey = process.env.CLEANER_APP_API_KEY;
    if (!expectedKey) {
      return NextResponse.json(
        { error: "Capture endpoint is not configured" },
        { status: 503 }
      );
    }

    const apiKey = req.headers.get("x-api-key");
    if (!apiKey || apiKey !== expectedKey) {
      return NextResponse.json(
        { error: "Unauthorized: Invalid or missing API key" },
        { status: 401 }
      );
    }

    const { jobId } = await req.json();
    if (!jobId) {
      return NextResponse.json({ error: "Job ID is required" }, { status: 400 });
    }

    const outcome = await captureAndCreatePayouts(jobId);
    return NextResponse.json(outcome.body, { status: outcome.httpStatus });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Job completion capture failed:", error);
    return NextResponse.json(
      { error: "Internal server error", details: message },
      { status: 500 }
    );
  }
}
