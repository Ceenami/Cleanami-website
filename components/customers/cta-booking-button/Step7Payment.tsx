import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { StripeElementsOptions } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';
import { toast } from 'sonner';
import { PriceDetails, SignupFormData } from '@/lib/validations/bookng-modal';
import { serializeSignupFormDataForServer } from '@/lib/validations/bookng-modal/serialize-signup-form';
import { CheckoutForm } from './CheckoutForm';
import { PromoCodeField } from './PromoCodeField';
import { FounderCard } from '../../FounderCard';
import { ShieldCheck, Lock } from 'lucide-react';
import { isServiceUnavailableMessage } from '@/lib/env/messages';
import { getStripe } from '@/lib/stripe/client';
import { THIRTY_DAY_MINIMUM } from '@/lib/subscriptions/minimum';
import { PURCHASE_DATE_START } from '@/lib/subscriptions/purchase-start';

const stripePromise = getStripe();

interface Props {
  priceDetails: PriceDetails | null;
  formData: SignupFormData;
  setFormData: React.Dispatch<React.SetStateAction<SignupFormData>>;
  onPaymentSuccess: (paymentIntentId: string, chargedAmountCents: number | null) => void;
  onBookCall?: () => void;
  onContinueSetup?: () => void;
  paymentFinalizing?: boolean;
  /**
   * Whether the customer has committed to paying, so the Stripe form is shown.
   * Owned by `SignupForm` because the footer renders the primary
   * "Activate Your Subscription" button that flips it, next to Back.
   */
  showPaymentForm: boolean;
  onShowPaymentForm: () => void;
}

export const Step7Payment = ({
  priceDetails,
  formData,
  setFormData,
  onPaymentSuccess,
  onBookCall,
  paymentFinalizing = false,
  showPaymentForm,
  onShowPaymentForm,
}: Props) => {
  const [clientSecret, setClientSecret] = useState('');
  const [amountInCents, setAmountInCents] = useState<number | null>(null);
  const [minimumPolicy, setMinimumPolicy] = useState<string | undefined>();
  const [termEndPolicy, setTermEndPolicy] = useState<string | undefined>();
  const [financePolicy, setFinancePolicy] = useState<string | undefined>();
  const [startPolicy, setStartPolicy] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);

  const serializedFormData = useMemo(
    () => serializeSignupFormDataForServer(formData),
    [formData]
  );

  const paymentRequestKey = useMemo(
    () =>
      JSON.stringify({
        formData: serializedFormData,
        amount: priceDetails?.totalPerClean ?? 0,
      }),
    [serializedFormData, priceDetails?.totalPerClean]
  );

  const initializePayment = useCallback(async () => {
    if (!priceDetails || priceDetails.totalPerClean <= 0) {
      return;
    }

    setIsInitializing(true);
    setError(null);
    setClientSecret('');
    setAmountInCents(null);
    setMinimumPolicy(undefined);
    setTermEndPolicy(undefined);
    setFinancePolicy(undefined);
    setStartPolicy(undefined);

    try {
      const response = await fetch('/api/payment/create-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formData: serializedFormData,
        }),
      });

      const result = (await response.json()) as {
        clientSecret?: string;
        amountInCents?: number;
        minimumCommitmentPolicy?: string;
        termEndPolicy?: string;
        financePolicy?: string;
        subscriptionStartPolicy?: string;
        error?: string;
      };

      if (!response.ok || result.error) {
        const message =
          result.error ??
          'Could not initialize payment. Please refresh and try again.';
        setError(message);
        if (isServiceUnavailableMessage(message)) {
          toast.error(message);
        }
        return;
      }

      if (result.clientSecret) {
        setClientSecret(result.clientSecret);
        setAmountInCents(result.amountInCents ?? null);
        setMinimumPolicy(result.minimumCommitmentPolicy);
        setTermEndPolicy(result.termEndPolicy);
        setFinancePolicy(result.financePolicy);
        setStartPolicy(result.subscriptionStartPolicy);
      } else {
        setError('Could not initialize payment. Please refresh and try again.');
      }
    } catch (initError) {
      console.error('Payment initialization failed:', initError);
      setError(
        'Could not reach the payment service. Check your connection and try again.'
      );
    } finally {
      setIsInitializing(false);
    }
  }, [priceDetails, serializedFormData]);

  // Which payload the live clientSecret was created for. The guard used to be
  // "already have a clientSecret -> never re-initialize", which silently kept a
  // stale PaymentIntent when the booking changed underneath it — applying a
  // promo code would show the discount but charge the pre-promo amount.
  // Keyed on the payload instead: initialize once per distinct booking, and
  // rebuild whenever the amount that will be charged could have moved.
  const initializedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (paymentFinalizing) {
      return;
    }

    if (!showPaymentForm && onBookCall) {
      return;
    }

    if (initializedKeyRef.current === paymentRequestKey) {
      return;
    }

    initializedKeyRef.current = paymentRequestKey;
    void initializePayment();
  }, [
    paymentRequestKey,
    showPaymentForm,
    onBookCall,
    initializePayment,
    paymentFinalizing,
  ]);

  const applyPromoCode = useCallback(
    (code: string) => {
      setFormData((prev) => ({ ...prev, promoCode: code || undefined }));
    },
    [setFormData]
  );

  const appearance = { theme: 'stripe' as const, variables: { colorPrimary: '#14b8a6' } };
  const options: StripeElementsOptions = { clientSecret, appearance };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900">Secure Payment & Activation</h3>
        <p className="mt-1 text-sm text-gray-600">
          Enter your payment details to prepay for your first clean and activate your subscription.
        </p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-amber-800 font-medium">
          Want to double-check everything before activating?
        </p>
      </div>

      {!showPaymentForm && onBookCall && (
        <FounderCard
          onBookCall={onBookCall}
          onContinue={onShowPaymentForm}
          continueLabel="Activate Your Subscription"
          continueIsPrimary
        />
      )}

      {(showPaymentForm || !onBookCall) && (
        <>
          <PromoCodeField
            formData={formData}
            onApply={applyPromoCode}
            disabled={isInitializing || paymentFinalizing}
          />

          {amountInCents !== null && !error && (
            <div className="flex items-baseline justify-between rounded-lg bg-gray-50 border border-gray-200 px-4 py-3">
              <span className="text-sm font-medium text-gray-700">
                Charged today (first clean)
              </span>
              <span className="text-lg font-semibold text-gray-900">
                ${(amountInCents / 100).toFixed(2)}
              </span>
            </div>
          )}

          {error && (
            <div className="space-y-3">
              <div className="p-3 bg-red-50 text-red-700 border border-red-200 rounded-md text-sm">
                {error}
              </div>
              <button
                type="button"
                onClick={() => void initializePayment()}
                disabled={isInitializing}
                className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                {isInitializing ? 'Retrying…' : 'Try again'}
              </button>
            </div>
          )}

          {clientSecret && !error ? (
            <>
              {startPolicy === PURCHASE_DATE_START && <p className="text-sm text-gray-700">
                Your {formData.subscriptionMonths}-month term starts on the date payment succeeds,
                using US Eastern calendar dates, and lasts at least 30 days. It ends without
                automatic renewal. Your first clean can be scheduled after the seven-day setup
                period; this payment does not itself schedule a clean. Unused property credit
                survives subscription end.
              </p>}
              <p className="text-sm text-gray-600">
                {startPolicy === PURCHASE_DATE_START ? "The 30-day minimum begins on the successful payment date. Individual cleans follow the cancellation policy." : minimumPolicy === THIRTY_DAY_MINIMUM
                  ? "Your subscription has a 30-day minimum from its service start date, using US Eastern calendar days. You can cancel the subscription after that minimum; individual cleans follow the cancellation policy."
                  : "Your subscription has a first-month minimum from its service start date. You can cancel the subscription after that minimum; individual cleans follow the cancellation policy."}
              </p>
              {termEndPolicy === "stop_at_selected_end_v1" && <p className="text-sm text-gray-600">Service ends on your selected end date without automatic renewal. New cleans after that date require an explicit extension. A short one-month term lasts at least the 30-day minimum.</p>}
              <Elements options={options} stripe={stripePromise}>
                <CheckoutForm onPaymentSuccess={(id) => onPaymentSuccess(id, amountInCents)}
                  beforeConfirm={financePolicy ? async () => {
                    const response = await fetch("/api/payment/accept-rental-terms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientSecret, accepted: true }) });
                    if (!response.ok) throw Error("Could not record your payment agreement. Please retry before paying.");
                  } : undefined}
                  consentText={financePolicy ? "I authorize CleanNami to save this payment method and charge accepted scheduled-clean amounts after completion, and the full scheduled price for customer cancellations less than 24 hours before start. At least 24 hours before start there is no late fee. This purchase funds first-clean credit for this property, preserved on cancellation/rescheduling or term end; late fees are separate. Standard refunds require an approved exception. Changed scope requiring extra payment will be presented for approval." : undefined} />
              </Elements>
            </>
          ) : (
            !error && (
              <div className="h-48 flex flex-col items-center justify-center gap-3">
                <div className="spinner" />
                <p className="text-sm text-gray-500">Preparing secure checkout…</p>
              </div>
            )
          )}

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 flex items-start gap-3">
            <Lock className="w-5 h-5 text-gray-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-gray-700 font-medium">
                Payments are processed securely via Stripe.
              </p>
              <p className="text-sm text-gray-600 mt-1">
                {financePolicy ? "Your property credit is funded now. It is applied to an eligible completed clean. Other scheduled cleans are charged after final evidence; any late-cancellation fee is collected separately." : "Your first clean is charged now. Later cleans are authorized the night before and captured only after the job is completed."}
              </p>
            </div>
          </div>
        </>
      )}

      <style jsx>{`
        .spinner {
          border: 3px solid #e5e7eb;
          border-top: 3px solid #14b8a6;
          border-radius: 50%;
          width: 40px;
          height: 40px;
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};
