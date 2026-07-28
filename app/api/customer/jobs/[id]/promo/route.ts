import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  customerAuthErrorStatus,
  getCustomerAuth,
} from "@/lib/customer-auth";
import {
  applyPromoCodeToJob,
  PromoActionError,
  removePromoCodeFromJob,
} from "@/lib/services/customer-promo.service";

const bodySchema = z.object({
  code: z.string().trim().min(1).max(64),
});

/**
 * Only a `PromoActionError` carries a message meant for the customer. Anything
 * else is an internal fault, and echoing its `message` would ship driver
 * internals (SQL text, bound parameters, row ids) to the browser.
 */
function errorResponse(error: unknown, fallback: string) {
  if (error instanceof PromoActionError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status }
    );
  }
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { customerId, error } = await getCustomerAuth();
  if (!customerId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized" },
      { status: customerAuthErrorStatus(error) }
    );
  }

  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Enter a promo code." },
        { status: 400 }
      );
    }

    const { id } = await params;
    const result = await applyPromoCodeToJob(id, customerId, parsed.data.code);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("[POST /api/customer/jobs/[id]/promo]", err);
    return errorResponse(err, "Could not apply that promo code.");
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { customerId, error } = await getCustomerAuth();
  if (!customerId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized" },
      { status: customerAuthErrorStatus(error) }
    );
  }

  try {
    const { id } = await params;
    await removePromoCodeFromJob(id, customerId);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[DELETE /api/customer/jobs/[id]/promo]", err);
    return errorResponse(err, "Could not remove that promo code.");
  }
}
