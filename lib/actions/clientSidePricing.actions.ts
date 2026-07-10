"use server";

import { PricingService } from "@/lib/services/pricing.service";
import { PriceDetails, SignupFormData } from "@/lib/validations/bookng-modal";

export async function getLivePrice(
  formData: SignupFormData
): Promise<PriceDetails> {
  const pricingService = new PricingService();
  const priceDetails = await pricingService.calculatePrice(formData);
  return priceDetails;
}