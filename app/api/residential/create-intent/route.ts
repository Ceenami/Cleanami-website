import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { createResidentialPaymentIntent } from "@/lib/services/residential-booking.service";
import type { ResidentialFormData } from "@/lib/validations/residential";

const bodySchema = z.object({
  formData: z.record(z.string(), z.unknown()),
});

/** Same cookie the onboarding session uses; it is what makes the charge idempotent. */
const SESSION_COOKIE = "cleannami_session";

/**
 * The single money path for a residential booking.
 *
 * Every refusal — under 48 hours, a custom-size
 * home, an out-of-area address — is decided inside
 * `createResidentialPaymentIntent` BEFORE Stripe is touched, so a 400 from here
 * means no PaymentIntent was created and no record of any kind exists. That is
 * The whole shape: blocked, not queued.
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid booking request." },
        { status: 400 }
      );
    }

    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(SESSION_COOKIE)?.value ?? null;

    const result = await createResidentialPaymentIntent({
      formData: parsed.data.formData as ResidentialFormData,
      sessionToken,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          reason: result.reason,
          earliestBookableDate: result.earliestBookableDate ?? null,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      clientSecret: result.clientSecret,
      amountInCents: result.amountInCents,
    });
  } catch (error) {
    console.error("[POST /api/residential/create-intent]", error);
    return NextResponse.json(
      { error: "Could not initialize payment. Please try again." },
      { status: 500 }
    );
  }
}
