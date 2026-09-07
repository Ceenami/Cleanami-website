"use client";

import { CheckCircle, Mail, ShieldCheck } from "lucide-react";
import { formatResidentialArrivalTime } from "@/lib/scheduling/residential-notice";

interface Props {
  paymentIntentId?: string;
  amountInCents?: number | null;
  cleanDate?: string;
  arrivalTime?: string;
  portalInviteEmailSent?: boolean;
}

/**
 * R6 — what happens next.
 *
 * The arrival time is named back to the customer because it is the thing they
 * will plan their day around. The access details are deliberately NOT echoed:
 * the box they typed them into holds door codes, and those stay off every
 * surface but the property row.
 */
export const R6Confirmation = ({
  paymentIntentId,
  amountInCents,
  cleanDate,
  arrivalTime,
  portalInviteEmailSent = true,
}: Props) => {
  const formattedArrivalTime = formatResidentialArrivalTime(arrivalTime);

  return (
    <div className="text-center py-6">
      <CheckCircle className="mx-auto h-14 w-14 text-teal-500" />
      <h3 className="mt-4 text-xl font-semibold text-gray-900">
        Your clean is booked
      </h3>
      <p className="mt-2 text-sm text-gray-600">
        We have your payment and your details. You will get a confirmation email
        shortly.
      </p>

      <div className="mt-6 text-left bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-2 text-sm">
        {cleanDate && (
          <div className="flex justify-between">
            <span className="text-gray-600">Date</span>
            <span className="font-medium text-gray-900">
              {new Date(`${cleanDate}T12:00:00`).toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </span>
          </div>
        )}
        {formattedArrivalTime && (
          <div className="flex justify-between">
            <span className="text-gray-600">Arrival time</span>
            <span className="font-medium text-gray-900">{formattedArrivalTime}</span>
          </div>
        )}
        {typeof amountInCents === "number" && (
          <div className="flex justify-between">
            <span className="text-gray-600">Paid today</span>
            <span className="font-medium text-gray-900">
              ${(amountInCents / 100).toFixed(2)}
            </span>
          </div>
        )}
        {paymentIntentId && (
          <div className="flex justify-between">
            <span className="text-gray-600">Reference</span>
            <span className="font-mono text-xs text-gray-700">
              {paymentIntentId}
            </span>
          </div>
        )}
      </div>

      <div className="mt-6 text-left space-y-3">
        <div className="flex items-start gap-3 text-sm text-gray-600">
          <ShieldCheck className="h-5 w-5 text-teal-600 flex-shrink-0 mt-0.5" />
          <span>
            We will assign a cleaner and confirm before your clean. Your access
            details are shared only with them.
          </span>
        </div>
        <div className="flex items-start gap-3 text-sm text-gray-600">
          <Mail className="h-5 w-5 text-teal-600 flex-shrink-0 mt-0.5" />
          <span>
            {portalInviteEmailSent
              ? "Check your inbox — we have sent you a link to set a password and see your clean."
              : "We could not send your account email just now. Contact us and we will set it up."}
          </span>
        </div>
      </div>
    </div>
  );
};
