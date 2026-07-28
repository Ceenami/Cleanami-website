import { NextResponse } from "next/server";
import { z } from "zod";
import {
  customerAuthErrorStatus,
  getCustomerAuth,
} from "@/lib/customer-auth";
import { previewOneOffPromoCode } from "@/lib/services/one-off.service";

const bodySchema = z.object({
  propertyId: z.string().uuid(),
  code: z.string().trim().min(1).max(64),
});

/**
 * Price a promo code against a one-off clean before booking, so the customer
 * sees what they will actually be charged rather than the undiscounted total
 * on the pay button. Preview only — `bookOneOffClean` re-resolves the code, so
 * nothing here can decide what is charged.
 *
 * Customer-scoped (unlike the public booking-checkout preview) because it
 * quotes against a property the caller must already own.
 */
export async function POST(request: Request) {
  const { customerId, error } = await getCustomerAuth();
  if (!customerId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized" },
      { status: customerAuthErrorStatus(error) }
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { valid: false, message: "Enter a promo code." },
      { status: 400 }
    );
  }

  try {
    const result = await previewOneOffPromoCode(
      customerId,
      parsed.data.propertyId,
      parsed.data.code
    );
    return NextResponse.json(result);
  } catch (err) {
    console.error("[POST /api/customer/one-off/preview-promo]", err);
    return NextResponse.json(
      { valid: false, message: "Could not check that code. Please try again." },
      { status: 500 }
    );
  }
}
