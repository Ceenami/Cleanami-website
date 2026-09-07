"use client";

import { useMemo } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { AlertTriangle, CalendarIcon, Clock } from "lucide-react";

import type { ResidentialFormData } from "@/lib/validations/residential";
import { StepFeedback } from "../StepFeedback";
import {
  earliestBookableDate,
  formatResidentialArrivalTime,
  getBookableArrivalTimes,
  RESIDENTIAL_NOTICE_MESSAGE,
} from "@/lib/scheduling/residential-notice";

interface Props {
  formData: ResidentialFormData;
  setFormData: React.Dispatch<React.SetStateAction<ResidentialFormData>>;
  errors: Record<string, string[] | undefined>;
}

function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fromDateKey(key: string | undefined): Date | undefined {
  if (!key) return undefined;
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

/** Residential appointments use an exact arrival time, not a turnover window. */
export const R3When = ({ formData, setFormData, errors }: Props) => {
  const earliest = useMemo(() => earliestBookableDate(), []);
  const bookableArrivalTimes = useMemo(
    () =>
      formData.cleanDate ? getBookableArrivalTimes(formData.cleanDate) : [],
    [formData.cleanDate]
  );

  const selectedDate = fromDateKey(formData.cleanDate);
  const earliestDate = fromDateKey(earliest ?? undefined);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900">When suits you?</h3>
        <p className="mt-1 text-sm text-gray-600">
          Pick a date and the time you would like your cleaner to arrive.
        </p>
      </div>

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
              // A new date may change which times meet the 48-hour notice.
              arrivalTime: undefined,
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

            {bookableArrivalTimes.length === 0 ? (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-yellow-800">
                  {RESIDENTIAL_NOTICE_MESSAGE} Please choose a later date.
                </p>
              </div>
            ) : (
              <div>
                <label
                  htmlFor="residential-arrival-time"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  Arrival time
                </label>
                <select
                  id="residential-arrival-time"
                  value={formData.arrivalTime ?? ""}
                  onChange={(event) =>
                    setFormData((prev) => ({
                      ...prev,
                      arrivalTime: event.target.value || undefined,
                    }))
                  }
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  required
                >
                  <option value="">Select an arrival time</option>
                  {bookableArrivalTimes.map((arrivalTime) => (
                    <option key={arrivalTime} value={arrivalTime}>
                      {formatResidentialArrivalTime(arrivalTime)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}
      </div>

      <StepFeedback
        errors={errors}
        fields={["cleanDate", "arrivalTime"]}
        message="Please choose a date and an arrival time."
      />
    </div>
  );
};
