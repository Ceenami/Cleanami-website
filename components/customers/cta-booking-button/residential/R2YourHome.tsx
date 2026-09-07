"use client";

import { CheckCircle, XCircle } from "lucide-react";
import type { ResidentialFormData } from "@/lib/validations/residential";
import { AddressAutocomplete } from "../AddressAutoComplete";
import { StepFeedback } from "../StepFeedback";
import { PetsField } from "../PetsField";
import { PETS_QUESTION_RESIDENTIAL } from "@/lib/constants/service-type";

interface Props {
  formData: ResidentialFormData;
  setFormData: React.Dispatch<React.SetStateAction<ResidentialFormData>>;
  errors: Record<string, string[] | undefined>;
}

const inputClass =
  "block w-full px-3 py-2 border text-gray-800 rounded-md shadow-sm focus:outline-none focus:ring-teal-500 focus:border-teal-500 sm:text-sm";

/**
 * R2 — your home. Address (with the shared autocomplete and its service-area
 * feedback), size, and item 7's pets question in its residential wording.
 *
 * No guest check-in / check-out times, and no iCal: a home has no guests. Item
 * 4 is explicit that the residential flow does not carry them.
 */
export const R2YourHome = ({ formData, setFormData, errors }: Props) => {
  const handleNumber = (
    field: "sqft" | "bedrooms" | "bathrooms",
    value: string
  ) => {
    // Digits only. A stray character used to make `Number(value)` NaN on the
    // vacation-rental form, which priced the property at $0 without saying why.
    const digits = value.replace(/[^0-9]/g, "");
    setFormData((prev) => ({ ...prev, [field]: Number(digits) }));
  };

  /** 0 renders empty so the box can be cleared and retyped; the schema still
   *  rejects it, so an empty field cannot be skipped past. */
  const numberValue = (value: number | undefined) => (value ? String(value) : "");

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900">Your home</h3>
        <p className="mt-1 text-sm text-gray-600">
          These details set your price and how long the clean takes.
        </p>
      </div>

      <div>
        <label
          htmlFor="address"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Home address
        </label>
        <AddressAutocomplete
          formData={formData}
          setFormData={setFormData}
          errors={errors}
        />
        {formData.isAddressInServiceArea === true && (
          <div className="mt-2 flex items-center text-sm text-green-600">
            <CheckCircle className="h-4 w-4 mr-2" />
            Great! This address is in our service area.
          </div>
        )}
        {formData.isAddressInServiceArea === false && (
          <div className="mt-2 flex items-center text-sm text-red-600">
            <XCircle className="h-4 w-4 mr-2" />
            Sorry, this address is outside our service area.
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div>
          <label htmlFor="sqft" className="block text-sm font-medium text-gray-700 mb-1">
            Square footage
          </label>
          <input
            type="text"
            inputMode="numeric"
            id="sqft"
            name="sqft"
            placeholder="1500"
            value={numberValue(formData.sqft)}
            onChange={(e) => handleNumber("sqft", e.target.value)}
            className={`${inputClass} ${errors.sqft ? "border-red-500" : "border-gray-300"}`}
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
            id="bedrooms"
            name="bedrooms"
            value={numberValue(formData.bedrooms)}
            onChange={(e) => handleNumber("bedrooms", e.target.value)}
            className={`${inputClass} ${
              errors.bedrooms ? "border-red-500" : "border-gray-300"
            }`}
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
            id="bathrooms"
            name="bathrooms"
            value={numberValue(formData.bathrooms)}
            onChange={(e) => handleNumber("bathrooms", e.target.value)}
            className={`${inputClass} ${
              errors.bathrooms ? "border-red-500" : "border-gray-300"
            }`}
            required
          />
        </div>
      </div>

      {/* Item 7, in the client's residential wording. */}
      <PetsField
        question={PETS_QUESTION_RESIDENTIAL}
        value={formData.petsAllowed}
        onChange={(petsAllowed) =>
          setFormData((prev) => ({ ...prev, petsAllowed }))
        }
        idPrefix="res-pets"
      />

      <div className="rounded-lg border border-gray-200 p-4 space-y-3">
        <label className="flex items-start gap-3 text-sm text-gray-800">
          <input
            type="checkbox"
            checked={formData.hasHotTub}
            onChange={(event) =>
              setFormData((prev) => ({
                ...prev,
                hasHotTub: event.target.checked,
                hotTubService: event.target.checked ? prev.hotTubService : false,
              }))
            }
            className="mt-0.5 h-4 w-4"
          />
          <span>I have a hot tub at this home.</span>
        </label>
        {formData.hasHotTub && (
          <label className="flex items-start gap-3 text-sm text-gray-800">
            <input
              type="checkbox"
              checked={formData.hotTubService}
              onChange={(event) =>
                setFormData((prev) => ({
                  ...prev,
                  hotTubService: event.target.checked,
                }))
              }
              className="mt-0.5 h-4 w-4"
            />
            <span>
              Add basic hot-tub service to this clean. The price updates above.
            </span>
          </label>
        )}
      </div>

      <StepFeedback
        errors={errors}
        fields={[
          "address",
          "isAddressInServiceArea",
          "sqft",
          "bedrooms",
          "bathrooms",
        ]}
        message="Fields are required to proceed."
      />
    </div>
  );
};
