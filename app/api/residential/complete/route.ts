import { NextRequest, NextResponse } from "next/server";
import { completeResidentialBooking } from "@/lib/services/residential-booking.service";
import type { ResidentialFormData } from "@/lib/validations/residential";

/**
 * Finalise a paid residential booking.
 *
 * The customer has already been charged by the time this runs, so every
 * rejection here strands a paid customer — which is exactly why the refusals
 * all live in `/api/residential/create-intent`, before the card is touched.
 * What is left here is the replay verification: the PaymentIntent's metadata
 * (written with the secret key) must match the submitted booking, and the
 * amount must match a fresh server re-price.
 */
export async function POST(request: NextRequest) {
  try {
    const json = (await request.json()) as {
      paymentIntentId?: string;
      formData?: ResidentialFormData;
    };

    if (!json.paymentIntentId || !json.formData) {
      return NextResponse.json(
        { error: "Missing payment or booking details." },
        { status: 400 }
      );
    }

    const result = await completeResidentialBooking(
      json.formData,
      json.paymentIntentId
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("[POST /api/residential/complete]", error);
    return NextResponse.json(
      { error: "Could not finalize your booking. Please contact support." },
      { status: 500 }
    );
  }
}
