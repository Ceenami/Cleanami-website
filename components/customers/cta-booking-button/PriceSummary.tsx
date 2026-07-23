import { PriceDetails } from "@/lib/validations/bookng-modal";
import { Tag, HelpCircle, AlertTriangle } from "lucide-react";
import { PriceRow } from "./Pricerow";

interface Props {
  priceDetails: PriceDetails | null;
}

export const PriceSummary = ({ priceDetails }: Props) => {
  // Only a genuinely absent quote shows the placeholder. `basePrice === 0` must
  // NOT be used as that signal: the form starts at 2 bed / 1 bath, so a price is
  // always computable, and a 0 means we failed to price the property. Treating
  // that as "nothing entered yet" is what made the price silently disappear.
  if (!priceDetails) {
    return (
      <div className="bg-gray-50 rounded-lg p-6 h-full flex flex-col items-center justify-center text-center">
        <Tag className="h-10 w-10 text-gray-400 mb-4" />
        <h4 className="font-semibold text-gray-700">Your Price Estimate</h4>
        <p className="text-sm text-gray-500 mt-1">
          Your estimated cost per cleaning will appear here once you enter
          property details.
        </p>
      </div>
    );
  }

  if (priceDetails.pricingUnavailable) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 h-full flex flex-col items-center justify-center text-center">
        <AlertTriangle className="h-10 w-10 text-red-500 mb-4" />
        <h4 className="font-semibold text-red-800">
          Pricing Temporarily Unavailable
        </h4>
        <p className="text-sm text-red-700 mt-1">
          We could not load our pricing right now. Please continue and we will
          confirm your price, or contact us and we will help straight away.
        </p>
      </div>
    );
  }

  if (priceDetails.isCustomQuote) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 h-full flex flex-col items-center justify-center text-center">
        <AlertTriangle className="h-10 w-10 text-yellow-500 mb-4" />
        <h4 className="font-semibold text-yellow-800">Custom Quote Required</h4>
        <p className="text-sm text-yellow-700 mt-1">
          Larger properties — over 3,000 sq ft, or with more bedrooms or
          bathrooms than our standard pricing covers — need a custom quote.
          Please continue and we will contact you with pricing.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 rounded-lg p-6 h-full">
      <h3 className="font-semibold text-lg text-gray-800 mb-4">
        Price per Clean
      </h3>
      <div className="space-y-1 text-sm">
        <PriceRow
          label="Base Price"
          value={`$${priceDetails.basePrice.toFixed(2)}`}
        />
        {priceDetails.sqftSurcharge > 0 && (
          <PriceRow
            label="Sq. Ft. Surcharge"
            value={`$${priceDetails.sqftSurcharge.toFixed(2)}`}
          />
        )}
        {priceDetails.largePropertySurcharge > 0 && (
          <PriceRow
            label="Large Property Surcharge"
            value={`$${priceDetails.largePropertySurcharge.toFixed(2)}`}
          />
        )}
        {priceDetails.laundryCost > 0 && (
          <PriceRow
            label="Laundry Service"
            value={`$${priceDetails.laundryCost.toFixed(2)}`}
          />
        )}
        {priceDetails.hotTubCost > 0 && (
          <PriceRow
            label="Hot Tub Service"
            value={`$${priceDetails.hotTubCost.toFixed(2)}`}
          />
        )}
        {priceDetails.discountAmount > 0 && (
          <div className="text-teal-600">
            <PriceRow
              label={`Subscription Discount (${Math.round(priceDetails.discountRate * 100)}%)`}
              value={`-$${priceDetails.discountAmount.toFixed(2)}`}
            />
          </div>
        )}

        <div className="pt-2 border-t border-gray-200 mt-2">
          <PriceRow
            label="Total per Clean"
            value={`$${priceDetails.totalPerClean.toFixed(2)}`}
            isBold={true}
          />
        </div>
      </div>
      {priceDetails.periodicCharges.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="font-semibold text-gray-700 mb-2 text-sm">
            Periodic Charges
          </h4>
          {priceDetails.periodicCharges.map((charge, index) => (
            <div key={index} className="text-xs text-gray-500 flex items-start">
              <HelpCircle className="h-3 w-3 mr-2 mt-0.5 flex-shrink-0" />
              <span>
                A <strong>${charge.amount} fee</strong> for the{" "}
                {charge.description} will be added to the clean when the service
                is due.
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
