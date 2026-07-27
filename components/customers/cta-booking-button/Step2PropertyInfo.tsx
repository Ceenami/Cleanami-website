import { StepsProps } from "@/lib/validations/bookng-modal";
import { StepFeedback } from "./StepFeedback";
import { AddressAutocomplete } from "./AddressAutoComplete";
import { CheckCircle, XCircle } from "lucide-react";
import { FounderCard } from "../../FounderCard";
import { toTimeInputValue, toTimeOfDay } from "@/lib/time-of-day";

interface Step2Props extends StepsProps {
  /** Whether to show the Founder Card (show after price is calculated) */
  showFounderCard?: boolean;
  /** Called when user books a call */
  onBookCall?: () => void;
  /** Called when user continues without booking */
  onContinueSetup?: () => void;
}

export const Step2PropertyInfo = ({
  formData,
  setFormData,
  errors,
  showFounderCard = false,
  onBookCall,
  onContinueSetup,
}: Step2Props) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    // Digits only: a stray character used to make `Number(value)` NaN, which
    // priced the property at $0 without ever saying why.
    const digits = value.replace(/[^0-9]/g, "");
    setFormData((prev) => ({ ...prev, [name]: Number(digits) }));
  };

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: toTimeOfDay(value) }));
  };

  /** 0 renders as an empty box so the field can be cleared and retyped; it
   *  still fails `z.number().positive()`, so an empty field cannot be skipped. */
  const numberValue = (value: number | undefined) =>
    value ? String(value) : "";

  const ServiceAreaFeedback = () => {
    if (formData.isAddressInServiceArea === true) {
      return (
        <div className="mt-2 flex items-center text-sm text-green-600">
          <CheckCircle className="h-4 w-4 mr-2" />
          Great! This address is in our service area.
        </div>
      );
    }
    if (formData.isAddressInServiceArea === false) {
      return (
        <div className="mt-2 flex items-center text-sm text-red-600">
          <XCircle className="h-4 w-4 mr-2" />
          Sorry, this address is outside our service area.
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      <div>
        <label
          htmlFor="address"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Property Address
        </label>
        <AddressAutocomplete
          formData={formData}
          setFormData={setFormData}
          errors={errors}
        />
        <ServiceAreaFeedback />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div>
          <label
            htmlFor="sqft"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Square Footage
          </label>
          <input
            type="text"
            inputMode="numeric"
            name="sqft"
            id="sqft"
            placeholder="1500"
            value={numberValue(formData.sqft)}
            onChange={handleChange}
            className={`block w-full px-3 py-2 border text-gray-800 border-gray-300 rounded-md shadow-sm focus:outline-none ${
              errors.sqft ? "border-red-500" : "border-gray-300"
            } focus:ring-teal-500 focus:border-teal-500 sm:text-sm`}
          />
        </div>
        <div>
          <label
            htmlFor="bedrooms"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Bedrooms
          </label>
          <input
            type="text"
            inputMode="numeric"
            name="bedrooms"
            id="bedrooms"
            min="1"
            value={numberValue(formData.bedrooms)}
            onChange={handleChange}
            className={`block w-full px-3 py-2 border text-gray-800 border-gray-300 rounded-md shadow-sm focus:outline-none ${
              errors.bedrooms ? "border-red-500" : "border-gray-300"
            } focus:ring-teal-500 focus:border-teal-500 sm:text-sm`}
            required
          />
        </div>
        <div>
          <label
            htmlFor="bathrooms"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Bathrooms
          </label>
          <input
            type="text"
            inputMode="numeric"
            name="bathrooms"
            id="bathrooms"
            min="1"
            value={numberValue(formData.bathrooms)}
            onChange={handleChange}
            className={`block w-full px-3 py-2 border text-gray-800 border-gray-300 rounded-md shadow-sm focus:outline-none ${
              errors.bathrooms ? "border-red-500" : "border-gray-300"
            } focus:ring-teal-500 focus:border-teal-500 sm:text-sm`}
            required
          />
        </div>

        <div className="w-full md:w-30">
          <label
            htmlFor="defaultCheckInTime"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Guest Check-In Time
          </label>
          <input
            type="time"
            name="defaultCheckInTime"
            id="defaultCheckInTime"
            step={60}
            value={toTimeInputValue(formData.defaultCheckInTime)}
            onChange={handleTimeChange}
            className={`block w-full px-3 py-2 border text-gray-800 border-gray-300 rounded-md shadow-sm focus:outline-none ${
              errors.defaultCheckInTime ? "border-red-500" : "border-gray-300"
            } focus:ring-teal-500 focus:border-teal-500 sm:text-sm`}
            required
          />
        </div>

        <div className="w-full md:w-30">
          <label
            htmlFor="defaultCheckOutTime"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Guest Check-Out Time
          </label>
          <input
            type="time"
            name="defaultCheckOutTime"
            id="defaultCheckOutTime"
            step={60}
            value={toTimeInputValue(formData.defaultCheckOutTime)}
            onChange={handleTimeChange}
            className={`block w-full px-3 py-2 border text-gray-800 border-gray-300 rounded-md shadow-sm focus:outline-none ${
              errors.defaultCheckOutTime ? "border-red-500" : "border-gray-300"
            } focus:ring-teal-500 focus:border-teal-500 sm:text-sm`}
            required
          />
        </div>
      </div>

      <StepFeedback
        errors={errors}
        fields={[
          "bathrooms",
          "bedrooms",
          "sqft",
          "address",
          "defaultCheckInTime",
          "defaultCheckOutTime",
        ]}
        message="Fields are required to proceed."
      />

      {/* Price reassurance text - shown when price is displayed (via PriceSummary component) */}
      {/* This text should appear near where the price is shown */}
      <div className="bg-teal-50 border border-teal-200 rounded-lg p-4">
        <p className="text-sm text-teal-800 font-medium">
          This is your base turnover price. No estimates, no hidden fees. This
          price stays consistent for every clean unless you change your property
          details. Optional services can be added before checkout.
        </p>
        <p className="text-sm text-teal-700 mt-1">
          This covers your standard turnover clean based on your property
          details. Optional services like laundry and hot tub care can be added
          next.
        </p>
      </div>

      {/* Founder Card - CALL DECISION POINT A (first branch point) */}
      {showFounderCard && onBookCall && onContinueSetup && (
        <FounderCard
          introText="Want help setting this up? I'll personally walk you through it, or you can keep going on your own."
          onBookCall={onBookCall}
          onContinue={onContinueSetup}
        />
      )}
    </div>
  );
};
