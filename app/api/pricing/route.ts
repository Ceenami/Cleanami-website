import { NextRequest, NextResponse } from "next/server";
import { PricingService } from "@/lib/services/pricing.service";
import { SignupFormData } from "@/lib/validations/bookng-modal";
import {
  deserializeSignupFormDataFromServer,
  SerializableSignupFormData,
} from "@/lib/validations/bookng-modal/serialize-signup-form";

const pricingService = new PricingService();

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SerializableSignupFormData;
    const formData: SignupFormData = deserializeSignupFormDataFromServer(body);
    const priceDetails = await pricingService.calculatePrice(formData);
    return NextResponse.json(priceDetails);
  } catch (err) {
    console.error("[POST /api/pricing]", err);
    return NextResponse.json(
      { error: "Failed to calculate price" },
      { status: 500 }
    );
  }
}
