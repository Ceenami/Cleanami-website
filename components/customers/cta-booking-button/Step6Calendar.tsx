import { StepsProps } from "@/lib/validations/bookng-modal";
import {
  CalendarDays,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Loader,
  ShieldCheck,
  Settings,
} from "lucide-react";
import React, { useState } from "react";
import { StepFeedback } from "./StepFeedback";
import { ICalInstructions } from "./ICalInstructions";
import { FounderCard } from "../../FounderCard";

interface Step6Props extends StepsProps {
  /** Called when user books a call */
  onBookCall?: () => void;
  /** Called when user continues without booking */
  onContinueSetup?: () => void;
}

type ValidationStatus =
  | "idle"
  | "validating"
  | "valid"
  | "invalid_url"
  | "no_future_events";

export const Step6Calendar = ({
  formData,
  setFormData,
  errors,
  onBookCall,
  onContinueSetup,
}: Step6Props) => {
  const [status, setStatus] = useState<ValidationStatus>("idle");

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, iCalUrl: e.target.value }));
    setStatus("idle");
  };

  const handleValidate = async () => {
    if (!formData.iCalUrl) {
      setStatus("invalid_url");
      return;
    }
    setStatus("validating");

    try {
      const res = await fetch("/api/ical/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: formData.iCalUrl }),
      });
      const result = (await res.json()) as { status: "valid" | "invalid_url" | "no_future_events" };
      setStatus(result.status);
    } catch {
      setStatus("invalid_url");
    }
  };

  const StatusMessage = () => {
    switch (status) {
      case "valid":
        return (
          <div className="flex items-center text-green-600">
            <CheckCircle className="mr-2 h-4 w-4" />
            Successfully validated and found future bookings.
          </div>
        );
      case "invalid_url":
        return (
          <div className="flex items-center text-red-600">
            <XCircle className="mr-2 h-4 w-4" />
            Invalid iCal URL. Please check the link and try again.
          </div>
        );
      case "no_future_events":
        return (
          <div className="flex items-center text-yellow-600">
            <AlertTriangle className="mr-2 h-4 w-4" />
            URL is valid, but no future bookings were found.
          </div>
        );
      case "validating":
        return (
          <div className="flex items-center text-gray-500">
            <Loader className="mr-2 h-4 w-4 animate-spin" />
            Validating...
          </div>
        );
      default:
        return (
          <div className="text-gray-500">
            Enter your iCal URL to sync your booking calendar.
          </div>
        );
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900">
          Sync Your Booking Calendar
        </h3>
        <p className="mt-1 text-sm text-gray-600">
          Paste your iCal URL from Airbnb, VRBO, etc., to automatically schedule
          turnovers.
        </p>
      </div>

      {/* Reassurance text ABOVE iCal input - per spec */}
      <div className="bg-teal-50 border border-teal-200 rounded-lg p-4 flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-teal-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm text-teal-800 font-medium">
            This step allows us to automatically schedule cleans when guests check out.
          </p>
          <p className="text-sm text-teal-700 mt-1">
            The calendar link is read-only. We cannot see guest details or modify bookings.
          </p>
        </div>
      </div>

      {/* Founder Card - CALL DECISION POINT C (ABOVE the iCal field) - per spec */}
      {onBookCall && onContinueSetup && (
        <FounderCard
          onBookCall={onBookCall}
          onContinue={onContinueSetup}
        />
      )}

      {/* iCal URL Input */}
      <div>
        <label
          htmlFor="iCalUrl"
          className="block text-sm font-medium text-gray-700"
        >
          iCal URL
        </label>
        <div className="mt-1 flex rounded-md shadow-sm">
          <div className="relative flex items-stretch flex-grow focus-within:z-10">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <CalendarDays className="h-5 w-5 text-gray-400" />
            </div>
            <input
              type="text"
              name="iCalUrl"
              id="iCalUrl"
              value={formData.iCalUrl || ""}
              onChange={handleChange}
              className={`focus:ring-teal-500 focus:border-teal-500 text-gray-800 block w-full rounded-none rounded-l-md pl-10 sm:text-sm ${
                errors.iCalUrl ? "border-red-500" : "border-gray-300"
              }`}
              placeholder="https://www.airbnb.com/calendar/ical/..."
            />
          </div>
          <button
            type="button"
            onClick={handleValidate}
            disabled={status === "validating"}
            className="-ml-px relative inline-flex items-center space-x-2 px-4 py-2 border border-gray-300 text-sm font-medium rounded-r-md text-gray-700 bg-gray-50 hover:bg-gray-100 disabled:opacity-50"
          >
            <span>
              {status === "validating" ? "Validating..." : "Validate"}
            </span>
          </button>
        </div>
        <div className="mt-2 text-sm h-5">{StatusMessage()}</div>
      </div>

      {/* Reassurance text BELOW iCal input - per spec */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 flex items-start gap-3">
        <Settings className="w-5 h-5 text-gray-500 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm text-gray-700">
            We only use your calendar to detect guest check-out dates.
          </p>
          <p className="text-sm text-gray-600 mt-1">
            You can remove or change this link at any time.
          </p>
        </div>
      </div>

      <ICalInstructions />

      <StepFeedback
        errors={errors}
        fields={["iCalUrl"]}
        message="A valid iCal URL is required to proceed."
      />
    </div>
  );
};