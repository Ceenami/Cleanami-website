import { NextResponse } from "next/server";
import { z } from "zod";
import {
  customerAuthErrorStatus,
  getCustomerAuth,
} from "@/lib/customer-auth";
import { bookOneOffClean } from "@/lib/services/one-off.service";

const bodySchema = z.object({
  propertyId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  promoCode: z.string().trim().max(64).optional(),
});

export async function POST(request: Request) {
  const { customerId, error } = await getCustomerAuth();
  if (!customerId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized" },
      { status: customerAuthErrorStatus(error) }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const result = await bookOneOffClean(customerId, parsed.data);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result);
}
