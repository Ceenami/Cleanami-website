import Link from "next/link";
import GoogleConversionTracking from "@/components/ConversionTracking";
import { CheckCircle, Sparkles } from "lucide-react";

interface Step8ConfirmationProps {
  paymentIntentId?: string;
  amount?: number;
  currency?: string;
  portalInviteEmailSent?: boolean;
}

export const Step8Confirmation = ({ 
  paymentIntentId, 
  amount, 
  currency = 'CHF',
  portalInviteEmailSent = true,
}: Step8ConfirmationProps) => {
  return (
    <div className="text-center py-8 px-4">
      {paymentIntentId && amount && (
        <GoogleConversionTracking
          transactionId={paymentIntentId}
          value={amount}
          currency={currency}
        />
      )}
      <div className="mx-auto flex items-center justify-center h-20 w-20 rounded-full bg-green-100">
        <CheckCircle className="h-12 w-12 text-green-600" />
      </div>
      <h2 className="mt-6 text-2xl font-bold text-gray-800">Setup Complete!</h2>
      {paymentIntentId ? (
        <p className="mt-2 text-gray-600 max-w-md mx-auto">
          Congratulations! Your subscription is active and your first cleaning is
          prepaid.
        </p>
      ) : (
        <p className="mt-2 text-gray-600 max-w-md mx-auto">
          Your booking details were saved, but payment was not completed. Please
          go back and finish payment to activate your subscription.
        </p>
      )}

      {paymentIntentId && portalInviteEmailSent ? (
        <p className="mt-6 text-sm text-gray-600 max-w-md mx-auto">
          Check your email for a link to sign in to your customer portal. You can
          set a password or use the magic link we sent.
        </p>
      ) : paymentIntentId ? (
        <p className="mt-6 text-sm text-gray-600 max-w-md mx-auto">
          Your portal is ready. Sign in at{" "}
          <Link href="/sign-in" className="font-semibold text-brand">
            /sign-in
          </Link>{" "}
          with the email you used for booking, or contact support if you need a
          new login link.
        </p>
      ) : null}

      <Link
        href="/sign-in"
        className="mt-4 inline-flex rounded-lg border border-brand px-6 py-3 text-sm font-semibold text-brand hover:bg-brand/5"
      >
        Go to sign in
      </Link>

      <div className="mt-8 bg-white border border-gray-200 rounded-lg p-6 max-w-sm mx-auto">
        <div className="flex items-center">
          <div className="bg-teal-500 p-2 rounded-full mr-4">
            <Sparkles className="h-6 w-6 text-white" />
          </div>
          <div>
            <h4 className="text-left font-semibold text-gray-800">
              What&apos;s Next?
            </h4>
            <p className="text-left text-sm text-gray-600">
              We&apos;ll monitor your iCal and automatically schedule your turnovers.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
