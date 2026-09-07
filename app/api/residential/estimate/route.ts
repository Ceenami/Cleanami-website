import { NextRequest, NextResponse } from "next/server";

import { estimateResidentialBooking } from "@/lib/services/residential-booking.service";

/**
 * A price-only endpoint for the live residential estimate. It intentionally
 * accepts no appointment or access information; those requirements belong to
 * the booking endpoint and must not make transparent pricing disappear.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      bedrooms?: number;
      bathrooms?: number;
      sqft?: number;
      petsAllowed?: boolean;
      hasHotTub?: boolean;
      hotTubService?: boolean;
    };
    const result = await estimateResidentialBooking({
      bedrooms: body.bedrooms ?? Number.NaN,
      bathrooms: body.bathrooms ?? Number.NaN,
      sqft: body.sqft ?? Number.NaN,
      petsAllowed: body.petsAllowed === true,
      hasHotTub: body.hasHotTub === true,
      hotTubService: body.hotTubService === true,
    });

    if (!result.ok) {
      return NextResponse.json({
        refused: true,
        reason: result.reason,
        message: result.error,
      });
    }

    return NextResponse.json({ refused: false, priceDetails: result.priceDetails });
  } catch (error) {
    console.error("[POST /api/residential/estimate]", error);
    return NextResponse.json(
      { error: "Failed to calculate price" },
      { status: 500 }
    );
  }
}
