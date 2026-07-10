"use client";

import { useState } from "react";
import { loadSessionByEmail } from "@/lib/actions/session.actions";
import { Mail, Loader, AlertCircle, ArrowRight } from "lucide-react";

interface ResumeVerificationProps {
  sessionId: string;
  onSuccess: (data: {
    formData: Record<string, unknown>;
    currentStep: number;
    priceDetails: Record<string, unknown> | null;
  }) => void;
  onCancel: () => void;
}

export function ResumeVerification({
  sessionId,
  onSuccess,
  onCancel,
}: ResumeVerificationProps) {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    const result = await loadSessionByEmail(sessionId, email);

    setIsLoading(false);

    if (result.success) {
      onSuccess({
        formData: result.formData as Record<string, unknown>,
        currentStep: result.currentStep,
        priceDetails: result.priceDetails as Record<string, unknown> | null,
      });
    } else {
      setError(result.error || "Could not find your session. Please check your email and try again.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="mx-auto w-16 h-16 bg-teal-100 rounded-full flex items-center justify-center mb-4">
          <Mail className="w-8 h-8 text-teal-600" />
        </div>
        <h3 className="text-xl font-semibold text-gray-900">
          Welcome Back!
        </h3>
        <p className="mt-2 text-gray-600">
          Enter the email you used to start your setup to continue where you left off.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="resume-email"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Email Address
          </label>
          <input
            type="email"
            id="resume-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            disabled={isLoading}
            className="block w-full px-3 py-2 border border-gray-300 text-gray-800 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-teal-500 focus:border-teal-500 sm:text-sm disabled:opacity-50"
          />
        </div>

        {error && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-md">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <div className="space-y-3">
          <button
            type="submit"
            disabled={isLoading || !email}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-brand text-white font-medium rounded-lg hover:bg-brand/80 transition-colors disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                Verifying...
              </>
            ) : (
              <>
                Continue Setup
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="w-full py-3 px-4 bg-white text-gray-700 font-medium rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Start Fresh Instead
          </button>
        </div>
      </form>

      <p className="text-xs text-gray-500 text-center">
        We use your email to verify it&apos;s you and protect your data.
      </p>
    </div>
  );
}