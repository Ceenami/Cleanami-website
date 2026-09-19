"use client";

import { useMemo } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { AlertTriangle, CalendarIcon, Clock } from "lucide-react";
import type { ResidentialFormData } from "@/lib/validations/residential";
import { RadioCard } from "../RadioCard";
import { StepFeedback } from "../StepFeedback";
import { calculateJobStaffing } from "@/lib/pricing/staffing-logic";
import {
  ARRIVAL_WINDOWS,
  getAvailableArrivalWindows,
} from "@/lib/scheduling/arrival-windows";
import {
  earliestBookableDate,
  getBookableWindows,
  RESIDENTIAL_NOTICE_MESSAGE,
  RESIDENTIAL_NO_WINDOW_MESSAGE,
} from "@/lib/scheduling/residential-notice";

interface Props {
  formData: ResidentialFormData;
  setFormData: React.Dispatch<React.SetStateAction<ResidentialFormData>>;
  errors: Record<string, string[] | undefined>;
}

/**
 * `YYYY-MM-DD` from a picker `Date`, using its LOCAL calendar fields.
 *
 * Not `toISOString().slice(0,10)`: that reads the UTC date, so a date picked
 * anywhere west of Greenwich in the evening comes back as the day before. The
 * picker hands us a midnight-local Date representing a calendar day, and a
 * calendar day is what we want.
 */
function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** The inverse, as a local midnight Date the picker can select. */
function fromDateKey(key: string | undefined): Date | undefined {
  if (!key) return undefined;
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

/**
 * R3 — when.
 *
 * Two rules meet on this step, and both are enforced again server-side. What
 * happens here is a courtesy, not the rule:
 *
 * The 48-hour rule. Under 48 hours is BLOCKED, not
 * queued. The picker will not offer a date that has no bookable window, and
 * within a date the windows that are under 48 hours out are not offered either
 * — because a date can be partly bookable: at 10am Monday, Wednesday's 9-11am
 * slot is 47 hours away and Wednesday's 1-3pm slot is 51.
 *
 * **The operating day.** Cleaners submit availability for a
 * 9 AM - 4 PM window, so a window is offered only when its LATEST arrival still
 * finishes inside that day. That is why a bigger home sees fewer windows, and
 * why a home whose clean runs long sees none and is told to call — selling a
 * slot nobody has declared themselves available for is the failure this avoids.
 */
export const R3When = ({ formData, setFormData, errors }: Props) => {
  const expectedHours = useMemo(() => {
    if (!formData.bedrooms || !formData.bathrooms) return 0;
    return calculateJobStaffing({
      bedCount: formData.bedrooms,
      bathCount: formData.bathrooms,
      sqFt: formData.sqft ?? null,
      laundryType: "none",
      hotTubServiceLevel: false,
      hotTubDeepClean: false,
    }).expectedHoursPerCleaner;
  }, [formData.bedrooms, formData.bathrooms, formData.sqft]);

  const windowsThatFitTheDay = useMemo(
    () => getAvailableArrivalWindows(expectedHours),
    [expectedHours]
  );

  const earliest = useMemo(
    () => earliestBookableDate(expectedHours),
    [expectedHours]
  );

  const bookableToday = useMemo(
    () =>
      formData.cleanDate
        ? getBookableWindows(formData.cleanDate, expectedHours)
        : [],
    [formData.cleanDate, expectedHours]
  );

  const selectedDate = fromDateKey(formData.cleanDate);
  const earliestDate = fromDateKey(earliest ?? undefined);

  if (windowsThatFitTheDay.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-medium text-gray-900">When suits you?</h3>
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-yellow-800">
            {RESIDENTIAL_NO_WINDOW_MESSAGE}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900">When suits you?</h3>
        <p className="mt-1 text-sm text-gray-600">
          Pick a date, then an arrival window. Your cleaner arrives inside that
          window and works until the clean is finished.
        </p>
      </div>

      {/* The client's sentence, verbatim). It is
          shown up front rather than only on refusal, so the disabled dates in
          the picker have a reason attached. */}
      <div className="bg-teal-50 border border-teal-200 rounded-lg p-4 flex items-start gap-3">
        <Clock className="h-5 w-5 text-teal-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm text-teal-800 font-medium">
            {RESIDENTIAL_NOTICE_MESSAGE}
          </p>
          {earliest && (
            <p className="text-sm text-teal-700 mt-1">
              Our earliest available date is{" "}
              {new Date(`${earliest}T12:00:00`).toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
              .
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-6 items-start">
        <DayPicker
          mode="single"
          selected={selectedDate}
          onSelect={(date) =>
            setFormData((prev) => ({
              ...prev,
              cleanDate: date ? toDateKey(date) : undefined,
              // A date change can invalidate the chosen window (a later date
              // makes more windows legal, an earlier one fewer), so the window
              // is cleared rather than silently carried onto a date where it is
              // under 48 hours out.
              arrivalWindow: undefined,
            }))
          }
          disabled={earliestDate ? { before: earliestDate } : undefined}
          className="border rounded-md p-2 text-gray-800"
          styles={{
            head_cell: { width: "40px" },
            day: { width: "40px", height: "40px" },
          }}
        />

        {formData.cleanDate && (
          <div className="w-full">
            <div className="flex items-center mb-3">
              <CalendarIcon className="h-5 w-5 text-teal-600 mr-2" />
              <span className="font-medium text-gray-800">
                {new Date(`${formData.cleanDate}T12:00:00`).toLocaleDateString(
                  "en-US",
                  { weekday: "long", month: "long", day: "numeric" }
                )}
              </span>
            </div>

            {bookableToday.length === 0 ? (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-yellow-800">
                  {RESIDENTIAL_NOTICE_MESSAGE} Please choose a later date.
                </p>
              </div>
            ) : (
              <>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Arrival window
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {bookableToday.map((window) => (
                    <RadioCard
                      key={window.key}
                      id={`window-${window.key}`}
                      name="arrivalWindow"
                      value={window.key}
                      checked={formData.arrivalWindow === window.key}
                      title={window.label}
                      description={`Your cleaner arrives in this window and needs about ${expectedHours.toFixed(
                        1
                      )} hours.`}
                      onChange={() =>
                        setFormData((prev) => ({
                          ...prev,
                          arrivalWindow: window.key,
                        }))
                      }
                    />
                  ))}
                </div>
                {bookableToday.length < ARRIVAL_WINDOWS.length && (
                  <p className="mt-3 text-xs text-gray-500">
                    Only windows your clean can finish inside our 9:00 AM -
                    4:00 PM working day are shown.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <StepFeedback
        errors={errors}
        fields={["cleanDate", "arrivalWindow"]}
        message="Please choose a date and an arrival window."
      />
    </div>
  );
};
