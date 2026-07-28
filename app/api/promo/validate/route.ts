import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { quoteFirstCleanChargeCents } from "@/lib/services/create-payment-intent.service";
import { resolvePromoCodeForAmount } from "@/lib/services/promo-code.service";
import {
  deserializeSignupFormDataFromServer,
  SerializableSignupFormData,
} from "@/lib/validations/bookng-modal/serialize-signup-form";

/**
 * Preview a promo code against the booking in progress (task 1.8).
 *
 * Public by necessity — it runs from the booking form before an account
 * exists. It is a preview only: applying the discount for real happens again
 * inside create-payment-intent, so nothing here can move money, and a wrong or
 * stale answer costs the customer nothing. It deliberately never enumerates
 * codes: an unknown code gets the same shaped response as a known one.
 */
const bodySchema = z.object({
  code: z.string().trim().min(1).max(64),
  formData: z.record(z.string(), z.unknown()),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = bodySchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { valid: false, message: "Enter a promo code." },
        { status: 400 }
      );
    }

    const formData = deserializeSignupFormDataFromServer(
      parsed.data.formData as SerializableSignupFormData
    );

    const quote = await quoteFirstCleanChargeCents(formData);
    if (!quote.ok) {
      return NextResponse.json(
        { valid: false, message: quote.error },
        { status: 400 }
      );
    }

    const { evaluation } = await resolvePromoCodeForAmount(
      parsed.data.code,
      quote.chargeBeforePromoCents,
      formData.email ?? ""
    );

    if (!evaluation.valid) {
      return NextResponse.json({ valid: false, message: evaluation.message });
    }

    return NextResponse.json({
      valid: true,
      code: evaluation.code,
      discountCents: evaluation.discountCents,
      finalAmountCents: evaluation.finalAmountCents,
      // True when the code was worth more than we can take off while keeping
      // the charge above Stripe's 50c floor — the UI shows the real number.
      capped: evaluation.capped,
    });
  } catch (error) {
    console.error("[POST /api/promo/validate]", error);
    return NextResponse.json(
      { valid: false, message: "Could not check that code. Please try again." },
      { status: 500 }
    );
  }
}
