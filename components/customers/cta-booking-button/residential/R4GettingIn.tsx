"use client";

import { ConditionReviewFields } from "./ConditionReviewFields";
import type { ResidentialFormData } from "@/lib/validations/residential";
import { AccessFields, type AccessFieldValues } from "../AccessFields";

interface Props {
  formData: ResidentialFormData;
  setFormData: React.Dispatch<React.SetStateAction<ResidentialFormData>>;
  errors: Record<string, string[] | undefined>;
}

/**
 * R4 — getting in. Counterproposal items 4, 5 and 6.
 *
 * The entry method, the access details and the parking note come from the
 * shared `AccessFields`, which the vacation-rental step 2 renders too — items
 * 5 and 6 apply to both service types, so there is one component, not two.
 *
 * This step collects credentials. `entryInstructions` holds door, lockbox, gate
 * and garage codes, and they may go to the `properties` row and nowhere else.
 *
 * Condition review is a separate, booking-specific disclosure. Access details
 * stay in the property fields above.
 */
export const R4GettingIn = ({ formData, setFormData, errors }: Props) => (
  <div className="space-y-6">
    <AccessFields
      heading="Getting in"
      values={{
        entryMethod: formData.entryMethod,
        entryInstructions: formData.entryInstructions,
        parkingInstructions: formData.parkingInstructions,
      }}
      errors={errors}
      onChange={(patch: AccessFieldValues) =>
        setFormData((prev) => ({ ...prev, ...patch }))
      }
    />

    <ConditionReviewFields selected={formData.unusualConditions} description={formData.conditionDescription}
      error={errors.conditionDescription?.[0]} onChange={patch => setFormData(prev => ({ ...prev, ...patch }))} />
    <div>
      <label
        htmlFor="specialNotes"
        className="block text-sm font-medium text-gray-700 mb-1"
      >
        Anything else we should know?
      </label>
      <textarea
        id="specialNotes"
        name="specialNotes"
        rows={3}
        maxLength={2000}
        placeholder="A room that needs extra attention, an alarm to disarm, a neighbour with a spare key…"
        value={formData.specialNotes ?? ""}
        onChange={(e) =>
          setFormData((prev) => ({ ...prev, specialNotes: e.target.value }))
        }
        className={`block w-full px-3 py-2 border text-gray-800 rounded-md shadow-sm focus:outline-none focus:ring-teal-500 focus:border-teal-500 sm:text-sm ${
          errors.specialNotes ? "border-red-500" : "border-gray-300"
        }`}
      />
    </div>
  </div>
);
