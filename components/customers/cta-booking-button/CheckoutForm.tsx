import React, { Suspense, useState } from 'react';
import { PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { LoadingFallback } from '@/components/LoadingFallback';

interface Props {
  onPaymentSuccess: (paymentIntentId: string) => void;
}

export const CheckoutForm = ({ onPaymentSuccess }: Props) => {
  const stripe = useStripe();
  const elements = useElements();

  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsLoading(true);

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });
    
    if (error) {
        if (error.type === "card_error" || error.type === "validation_error") {
            setMessage(error.message || "An unexpected error occurred.");
        } else {
            setMessage("An unexpected error occurred.");
        }
        setIsLoading(false);
        return;
    }

    if (paymentIntent && paymentIntent.status === 'succeeded') {
        onPaymentSuccess(paymentIntent.id);
    }
    
    setIsLoading(false);
  };

  return (
    <form id="payment-form" onSubmit={handleSubmit}>
      <Suspense fallback={<LoadingFallback message="Preparing Stripe" />}>
      <PaymentElement id="payment-element" options={{ layout: "tabs" }} />
        <button 
        disabled={isLoading || !stripe || !elements} 
        id="submit"
        className="w-full mt-6 py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-brand hover:bg-brand/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <span id="button-text">
          {isLoading ? <div className="spinner" /> : "Confirm & Pay"}
        </span>
      </button>
      </Suspense>
      
      
      
      {/* Show any error or success messages */}
      {message && <div id="payment-message" className="mt-2 text-sm text-red-600">{message}</div>}

      <style jsx>{`
        .spinner,
        .spinner:before,
        .spinner:after {
          border-radius: 50%;
          width: 1.5em;
          height: 1.5em;
          animation-fill-mode: both;
          animation: spin 1.8s infinite ease-in-out;
        }
        .spinner {
          color: #ffffff;
          font-size: 5px;
          margin: 0 auto;
          position: relative;
          text-indent: -9999em;
          transform: translateZ(0);
          animation-delay: -0.16s;
        }
        @keyframes spin {
          0%, 80%, 100% { box-shadow: 0 2.5em 0 -1.3em; }
          40% { box-shadow: 0 2.5em 0 0; }
        }
      `}</style>
    </form>
  );
};
