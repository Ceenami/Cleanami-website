import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { StripeElementsOptions } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';
import { toast } from 'sonner';
import { PriceDetails, SignupFormData } from '@/lib/validations/bookng-modal';
import { serializeSignupFormDataForServer } from '@/lib/validations/bookng-modal/serialize-signup-form';
import { CheckoutForm } from './CheckoutForm';
import { FounderCard } from '../../FounderCard';
import { ShieldCheck, Lock } from 'lucide-react';
import { isServiceUnavailableMessage } from '@/lib/env/messages';
import { getStripe } from '@/lib/stripe/client';

const stripePromise = getStripe();

interface Props {
  priceDetails: PriceDetails | null;
  formData: SignupFormData;
  onPaymentSuccess: (paymentIntentId: string) => void;
  onBookCall?: () => void;
  onContinueSetup?: () => void;
  paymentFinalizing?: boolean;
}

export const Step7Payment = ({ 
  priceDetails, 
  formData, 
  onPaymentSuccess,
  onBookCall,
  paymentFinalizing = false,
}: Props) => {
  const [clientSecret, setClientSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);

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

  useEffect(() => {
    if (paymentFinalizing || clientSecret) {
      return;
    }

    if (!showPaymentForm && onBookCall) {
      return;
    }

    void initializePayment();
  }, [
    paymentRequestKey,
    showPaymentForm,
    onBookCall,
    initializePayment,
    paymentFinalizing,
    clientSecret,
  ]);

  const appearance = { theme: 'stripe' as const, variables: { colorPrimary: '#14b8a6' } };
  const options: StripeElementsOptions = { clientSecret, appearance };

  const handleContinueToPayment = () => {
    setShowPaymentForm(true);
  };

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
          onContinue={handleContinueToPayment}
        />
      )}

      {(showPaymentForm || !onBookCall) && (
        <>
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
            <Elements options={options} stripe={stripePromise}>
              <CheckoutForm onPaymentSuccess={onPaymentSuccess} />
            </Elements>
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
                Your first clean is charged now. Later cleans are authorized the
                night before and captured only after the job is completed.
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
