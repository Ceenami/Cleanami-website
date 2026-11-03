import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { customerAuthErrorStatus, getCustomerAuth } from "@/lib/customer-auth";
import { quoteResidentialOneOff } from "@/lib/services/one-off.service";
const schema = z
  .object({
    propertyId: z.string().uuid(),
    cleaningLevel: z.enum(["standard", "deep"]),
    pricingVersion: z.enum(["residential-v1", "residential-v2"]).optional(),
    hotTub: z.enum(["none", "basic", "full"]),
    inUnitLaundryLoads: z.number().int().min(0).max(2),
  })
  .strict();
export async function POST(request: Request) {
  try {
    const { customerId, error } = await getCustomerAuth();
    if (!customerId)
      return NextResponse.json(
        { error: error ?? "Unauthorized" },
        { status: customerAuthErrorStatus(error) },
      );
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json(
        { refused: true, message: "Invalid quote selections." },
        { status: 400 },
      );
    return NextResponse.json(
      await quoteResidentialOneOff(customerId, { ...parsed.data, date: "" }),
    );
  } catch {
    return NextResponse.json(
      { refused: true, message: "Quote unavailable. Please try again." },
      { status: 503 },
    );
  }
}
