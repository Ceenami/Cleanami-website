import type { PriceDetails } from "@/lib/validations/bookng-modal";
import { classifyPropertySize } from "@/lib/pricing/staffing-logic";
import {
  CUSTOM_QUOTE_EXISTING_PROPERTY_MESSAGE,
  LAUNDRY_LOADS_INCOMPLETE_MESSAGE,
} from "@/lib/pricing/custom-quote-message";

/** A partial calculation is never a chargeable quote, even when it is positive. */
export function rentalQuoteRefusal(
  price: Pick<PriceDetails, "pricingUnavailable" | "isCustomQuote" | "laundryLoadsMissing">,
  home: { bedrooms?: number; bathrooms?: number; sqft?: number },
): string | null {
  if (price.pricingUnavailable)
    return "Pricing is temporarily unavailable. Please contact CleanNami support.";
  if (price.isCustomQuote) return CUSTOM_QUOTE_EXISTING_PROPERTY_MESSAGE;
  if (price.laundryLoadsMissing) return LAUNDRY_LOADS_INCOMPLETE_MESSAGE;
  // A negotiated price does not supply a reviewed staffing plan. Custom-size
  // jobs must be scheduled/staffed by the office rather than sold automatically.
  if (classifyPropertySize(home.bedrooms ?? 0, home.bathrooms ?? 0, home.sqft ?? 0) === "custom")
    return "This property needs a reviewed staffing plan. Please contact CleanNami support before booking.";
  return null;
}
