"use client";

import { RefreshCw, ArrowRight } from "lucide-react";

interface ResumeSessionPromptProps {
  currentStep: number;
  email?: string;
  onContinue: () => void;
  onStartFresh: () => void;
  isLoading?: boolean;
}

const stepNames: Record<number, string> = {
  1: "Customer Info",
  2: "Property Details",
  3: "Cleaning Checklist",
  4: "Service Add-ons",
  5: "First Clean Date",
  6: "Calendar Sync",
  7: "Payment",
};

export function ResumeSessionPrompt({
  currentStep,
  email,
  onContinue,
  onStartFresh,
  isLoading = false,
}: ResumeSessionPromptProps) {
  const stepName = stepNames[currentStep] || `Step ${currentStep}`;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="mx-auto w-16 h-16 bg-teal-100 rounded-full flex items-center justify-center mb-4">
          <RefreshCw className="w-8 h-8 text-teal-600" />
        </div>
        <h3 className="text-xl font-semibold text-gray-900">Welcome back!</h3>
        <p className="mt-2 text-gray-600">
          We found your saved progress{email ? ` for ${email}` : ""}.
        </p>
        <p className="text-sm text-gray-500 mt-1">
          You were on: <span className="font-medium">{stepName}</span>
        </p>
      </div>

      <div className="bg-teal-50 border border-teal-200 rounded-lg p-4">
        <p className="text-sm text-teal-800">
          <strong>Nothing is lost.</strong> All your previous information has been saved.
          Continue where you left off, or start fresh if you prefer.
        </p>
      </div>

      <div className="space-y-3">
        <button
          onClick={onContinue}
          disabled={isLoading}
          className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-brand text-white font-medium rounded-lg hover:bg-brand/80 transition-colors disabled:opacity-50"
        >
          Continue where I left off
          <ArrowRight className="w-4 h-4" />
        </button>

        <button
          onClick={onStartFresh}
          disabled={isLoading}
          className="w-full py-3 px-4 bg-white text-gray-700 font-medium rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          Start fresh
        </button>
      </div>
    </div>
  );
}