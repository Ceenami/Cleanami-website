import { NextRequest, NextResponse } from "next/server";
import { evaluateResidentialBooking } from "@/lib/services/residential-booking.service";
import type { ResidentialFormData } from "@/lib/validations/residential";

/**
 * Full residential booking eligibility check.
 *
 * The vacation-rental form asks `/api/pricing` for a number and decides for
 * itself whether to show a custom-quote card. Residential cannot work that way:
 * "Can we sell this?" is a bigger question than "what does it cost?" — a
 * 5 bed / 5 bath home prices fine and is
 * staffing-custom. So the server answers both at once, and the form renders
 * whichever it gets back.
 *
 * Returns a price with 200, or a refusal with 200 and `refused: true`. A
 * refusal is a normal outcome of a quote, not an error — a 4xx here would make
 * the form's fetch treat "we cannot clean this home" as a network failure and
 * keep showing a stale price.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ResidentialFormData;
    const result = await evaluateResidentialBooking(body);

    if (!result.ok) {
      return NextResponse.json({
        refused: true,
        reason: result.reason,
        message: result.error,
        earliestBookableDate: result.earliestBookableDate ?? null,
      });
    }

    return NextResponse.json({
      refused: false,
      priceDetails: result.priceDetails,
      arrivalTime: result.arrivalTime,
    });
  } catch (error) {
    console.error("[POST /api/residential/quote]", error);
    return NextResponse.json(
      { error: "Failed to calculate price" },
      { status: 500 }
    );
  }
}
