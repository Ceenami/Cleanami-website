import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateResidentialBooking } from "@/lib/services/residential-booking.service";
import { resolvePromoCodeForAmount } from "@/lib/services/promo-code.service";
import type { ResidentialFormData } from "@/lib/validations/residential";

const bodySchema = z.object({
  code: z.string().trim().min(1).max(64),
  formData: z.record(z.string(), z.unknown()),
});

/**
 * Price a promo code against a residential booking before the customer commits.
 *
 * PREVIEW ONLY. `createResidentialPaymentIntent` re-resolves the code against a
 * fresh server re-price, so nothing here can decide what is charged — only what
 * is shown. That separation is the whole reason this endpoint may be public:
 * the worst a caller can do with it is discover whether a code they already
 * know is currently valid, which the checkout form tells them anyway.
 *
 * Sibling of `/api/customer/one-off/preview-promo`, which is customer-scoped
 * because it quotes against a property the caller must already own. There is no
 * property here yet — the home is still just numbers on a form — so there is
 * nothing to scope to.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { valid: false, message: "Enter a promo code." },
      { status: 400 }
    );
  }

  try {
    // The same evaluation the real booking runs, so a code can never preview
    // against a price the customer would not actually be quoted.
    const quote = await evaluateResidentialBooking(
      parsed.data.formData as ResidentialFormData
    );
    if (!quote.ok) {
      return NextResponse.json({ valid: false, message: quote.error });
    }

    const { evaluation } = await resolvePromoCodeForAmount(
      parsed.data.code,
      quote.amountCents,
      (parsed.data.formData as ResidentialFormData).email ?? ""
    );

    if (!evaluation.valid) {
      return NextResponse.json({ valid: false, message: evaluation.message });
    }

    return NextResponse.json({
      valid: true,
      code: evaluation.code,
      discountCents: evaluation.discountCents,
      finalAmountCents: evaluation.finalAmountCents,
      capped: evaluation.capped,
    });
  } catch (err) {
    console.error("[POST /api/residential/preview-promo]", err);
    return NextResponse.json(
      { valid: false, message: "Could not check that code. Please try again." },
      { status: 500 }
    );
  }
}
