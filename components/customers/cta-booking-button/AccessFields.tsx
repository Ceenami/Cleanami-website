"use client";

import { ShieldCheck } from "lucide-react";
import {
  ENTRY_METHODS,
  getEntryMethod,
  type EntryMethod,
} from "@/lib/constants/service-type";

/**
 * Entry method, access details and parking — counterproposal items 5 and 6.
 *
 * One component, both wizards: items 5, 6, 11, 12 and 13 apply to "both
 * vacation rental and residential clean operations", and M3 is explicit that a
 * second design system is not the answer to a second flow.
 *
 * The access-details box holds door codes, and they must never travel into an
 * email, an SMS, a
 * push payload, a `notifications` row, `jobs.notes`, `jobs.addons_snapshot` or
 * Stripe metadata; only into the `properties` row, from which admin and the
 * ASSIGNED cleaner read it live. The reassurance line below is a promise this
 * code has to keep.
 *
 * The prompt is per method on purpose. "What is the lockbox code, and where is
 * the lockbox?" produces a usable answer; a generic "access notes" box produces
 * "see email".
 */
export type AccessFieldValues = {
  /**
   * Typed as the enum rather than `string`, so a value that could never satisfy
   * either form's schema cannot be put into form state in the first place. The
   * `<select>` narrows on the way out — an option this component did not render
   * can only come from a tampered DOM, and the field is simply cleared.
   */
  entryMethod?: EntryMethod;
  entryInstructions?: string;
  parkingInstructions?: string;
};

interface Props {
  values: AccessFieldValues;
  onChange: (patch: AccessFieldValues) => void;
  errors?: Record<string, string[] | undefined>;
  /** Rendered above the fields when the step is entirely about getting in. */
  heading?: string;
}

const inputClass =
  "block w-full px-3 py-2 border text-gray-800 border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-teal-500 focus:border-teal-500 sm:text-sm";

export const AccessFields = ({
  values,
  onChange,
  errors = {},
  heading,
}: Props) => {
  const method = getEntryMethod(values.entryMethod);

  return (
    <div className="space-y-6">
      {heading && (
        <div>
          <h3 className="text-lg font-medium text-gray-900">{heading}</h3>
          <p className="mt-1 text-sm text-gray-600">
            All optional — tell us as much or as little as you like.
          </p>
        </div>
      )}

      <div>
        <label
          htmlFor="entryMethod"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          How will the cleaner get in?
        </label>
        <select
          id="entryMethod"
          name="entryMethod"
          value={values.entryMethod ?? ""}
          onChange={(e) =>
            onChange({
              entryMethod: ENTRY_METHODS.some(
                (m) => m.value === e.target.value
              )
                ? (e.target.value as EntryMethod)
                : undefined,
            })
          }
          className={`${inputClass} ${
            errors.entryMethod ? "border-red-500" : ""
          }`}
        >
          <option value="">Select an option (optional)</option>
          {ENTRY_METHODS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {method && (
        <div>
          <label
            htmlFor="entryInstructions"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            {method.prompt}
          </label>
          <textarea
            id="entryInstructions"
            name="entryInstructions"
            rows={3}
            maxLength={2000}
            value={values.entryInstructions ?? ""}
            onChange={(e) =>
              onChange({ entryInstructions: e.target.value })
            }
            className={`${inputClass} ${
              errors.entryInstructions ? "border-red-500" : ""
            }`}
          />
          <div className="mt-2 flex items-start gap-2 text-xs text-gray-500">
            <ShieldCheck className="h-4 w-4 flex-shrink-0 text-teal-600" />
            <span>
              Access codes are shared only with the cleaner assigned to your
              clean, and with CleanNami staff. They are never sent by email or
              text.
            </span>
          </div>
        </div>
      )}

      <div>
        <label
          htmlFor="parkingInstructions"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Where should the cleaner park?
        </label>
        <textarea
          id="parkingInstructions"
          name="parkingInstructions"
          rows={2}
          maxLength={2000}
          placeholder="Driveway, guest spot 12, street parking on the north side…"
          value={values.parkingInstructions ?? ""}
          onChange={(e) => onChange({ parkingInstructions: e.target.value })}
          className={`${inputClass} ${
            errors.parkingInstructions ? "border-red-500" : ""
          }`}
        />
      </div>
    </div>
  );
};
