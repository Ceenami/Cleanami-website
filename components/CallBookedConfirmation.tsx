"use client";

import { CheckCircle, Mail, ArrowRight } from "lucide-react";

interface CallBookedConfirmationProps {
  /** User's email for display */
  email?: string;
  /** Called when user clicks to continue setup */
  onContinue: () => void;
  /** Called to dismiss the confirmation */
  onDismiss: () => void;
}

export function CallBookedConfirmation({
  email,
  onContinue,
  onDismiss,
}: CallBookedConfirmationProps) {
  return (
    <div className="fixed inset-0 bg-gray-800 bg-opacity-75 flex justify-center items-center z-[60] p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-6">
        {/* Success icon */}
        <div className="text-center">
          <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h3 className="text-xl font-semibold text-gray-900">
            Call Booked!
          </h3>
          <p className="mt-2 text-gray-600">
            Check your calendar invite for the Google Meet link.
          </p>
        </div>

        {/* Reassurance box */}
        <div className="bg-teal-50 border border-teal-200 rounded-lg p-4">
          <p className="text-sm text-teal-800">
            <strong>Nothing is lost.</strong> You&apos;ll resume exactly where you left off.
          </p>
        </div>

        {/* Email notice */}
        {email && (
          <div className="flex items-start gap-3 text-sm text-gray-600">
            <Mail className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />
            <p>
              We&apos;ve sent a resume link to <strong>{email}</strong> so you can 
              continue from any device.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="space-y-3">
          <button
            onClick={onContinue}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-brand text-white font-medium rounded-lg hover:bg-brand/80 transition-colors"
          >
            Continue setup now
            <ArrowRight className="w-4 h-4" />
          </button>

          <button
            onClick={onDismiss}
            className="w-full py-3 px-4 text-gray-600 font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            I&apos;ll finish later
          </button>
        </div>
      </div>
    </div>
  );
}