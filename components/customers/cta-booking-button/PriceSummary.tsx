import { PriceDetails } from "@/lib/validations/bookng-modal";
import { Tag, HelpCircle, AlertTriangle } from "lucide-react";
import { PriceRow } from "./Pricerow";

interface Props {
  priceDetails: PriceDetails | null;
}

export const PriceSummary = ({ priceDetails }: Props) => {
  if (!priceDetails || priceDetails.basePrice === 0) {
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

  if (priceDetails.isCustomQuote) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 h-full flex flex-col items-center justify-center text-center">
        <AlertTriangle className="h-10 w-10 text-yellow-500 mb-4" />
        <h4 className="font-semibold text-yellow-800">Custom Quote Required</h4>
        <p className="text-sm text-yellow-700 mt-1">
          Properties over 3,000 sq ft require a custom quote. Please continue
          and we will contact you with pricing.
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
