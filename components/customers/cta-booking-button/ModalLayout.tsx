import React from "react";
import { X } from "lucide-react";
import { PriceSummary } from "./PriceSummary";
import { PriceDetails } from "@/lib/validations/bookng-modal";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title: string;
  showPriceSummary: boolean;
  priceDetails: PriceDetails | null;
}

export const ModalLayout = ({
  isOpen,
  onClose,
  children,
  title,
  showPriceSummary,
  priceDetails,
}: Props) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-gray-800 bg-opacity-75 flex justify-center items-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-5 border-b">
          <h2 className="text-xl font-semibold text-gray-800">{title}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
        <div className="flex-grow overflow-y-auto">
          <div
            className={`grid ${
              showPriceSummary ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"
            } gap-8`}
          >
            <div className="p-6 md:p-8">{children}</div>
            {showPriceSummary && (
              <div className="p-6 md:p-8 bg-white border-l border-gray-100 hidden md:block">
                <PriceSummary priceDetails={priceDetails} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
