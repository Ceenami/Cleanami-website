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
  // Wrapped end to end. `bookOneOffClean` returns structured failures, but its
  // reads can still throw, and an unhandled throw in a route handler produces a
  // bare non-JSON 500 that the client can only report as "server error 500" —
  // which is exactly what the customer saw. React error boundaries do not wrap
  // route handlers, so this try/catch is the only place that can fix it.
  try {
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
      // Business refusals are the customer's to act on (400); infrastructure
      // faults are ours (5xx). Reporting "could not reach Stripe" as a 400
      // tells the customer their booking was invalid, which it was not.
      return NextResponse.json(
        { error: result.error },
        { status: result.status ?? (result.unexpected ? 500 : 400) }
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    // Never echo `err.message`: it can carry driver internals (SQL text, bound
    // parameters, row ids) or Stripe internals straight to the browser.
    console.error("[POST /api/customer/one-off]", err);
    return NextResponse.json(
      {
        error:
          "We could not complete this booking. Please try again, or contact CleanNami if you were charged.",
      },
      { status: 500 }
    );
  }
}
