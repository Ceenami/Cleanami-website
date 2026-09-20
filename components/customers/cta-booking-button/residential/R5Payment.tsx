"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Elements } from "@stripe/react-stripe-js";
import type { StripeElementsOptions } from "@stripe/stripe-js";
import { toast } from "sonner";
import { AlertTriangle, Lock } from "lucide-react";
import { CheckoutForm } from "../CheckoutForm";
import { getStripe } from "@/lib/stripe/client";
import { isServiceUnavailableMessage } from "@/lib/env/messages";
import type { ResidentialFormData } from "@/lib/validations/residential";
import { serializeResidentialFormForServer } from "@/lib/validations/residential/serialize";

const stripePromise = getStripe();

interface Props {
  formData: ResidentialFormData;
  onPaymentSuccess: (paymentIntentId: string) => void;
  paymentFinalizing?: boolean;
}

/**
 * R5 — payment.
 *
 * One money path: the clean is charged here and now, with
 * automatic capture. There is no authorization, no hold, and therefore nothing
 * that reasons about `capture_before` or a seven-day window; `automatic_payment_methods`
 * is fine.
 *
 * Every refusal the server can raise arrives here as a 400 from
 * `/api/residential/create-intent` — under 48 hours, an unstaffable window, a
 * custom-size home, an out-of-area address. In each case **no PaymentIntent was
 * created**, which is what makes the refusal a block rather than a queue. The
 * error is rendered in place, with the earliest bookable date when the server
 * offers one, because a homeowner turned away and told nothing useful is a
 * support conversation and a lost sale.
 */
export const R5Payment = ({
  formData,
  onPaymentSuccess,
  paymentFinalizing = false,
}: Props) => {
  const [clientSecret, setClientSecret] = useState("");
  const [amountInCents, setAmountInCents] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [earliestDate, setEarliestDate] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);

  const payload = useMemo(
    () => serializeResidentialFormForServer(formData),
    [formData]
  );
  const requestKey = useMemo(() => JSON.stringify(payload), [payload]);

  const initializePayment = useCallback(async () => {
    setIsInitializing(true);
    setError(null);
    setEarliestDate(null);
    setClientSecret("");
    setAmountInCents(null);

    try {
      const response = await fetch("/api/residential/create-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formData: payload }),
      });

      const result = (await response.json()) as {
        clientSecret?: string;
        amountInCents?: number;
        error?: string;
        earliestBookableDate?: string | null;
      };

      if (!response.ok || result.error) {
        const message =
          result.error ??
          "Could not start your booking. Please refresh and try again.";
        setError(message);
        setEarliestDate(result.earliestBookableDate ?? null);
        if (isServiceUnavailableMessage(message)) toast.error(message);
        return;
      }

      if (result.clientSecret) {
        setClientSecret(result.clientSecret);
        setAmountInCents(result.amountInCents ?? null);
      } else {
        setError("Could not start your booking. Please refresh and try again.");
      }
    } catch (initError) {
      console.error("Residential payment initialization failed:", initError);
      setError(
        "Could not reach the payment service. Check your connection and try again."
      );
    } finally {
      setIsInitializing(false);
    }
  }, [payload]);

  // Keyed on the payload, not on "do we already have a secret". The
  // vacation-rental step learned this the hard way: a "have a secret, never
  // re-initialize" guard kept a stale PaymentIntent when the booking changed
  // underneath it, and the customer was charged the old amount.
  const initializedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (paymentFinalizing) return;
    if (initializedKeyRef.current === requestKey) return;
    initializedKeyRef.current = requestKey;
    void initializePayment();
  }, [requestKey, initializePayment, paymentFinalizing]);

  const options: StripeElementsOptions = {
    clientSecret,
    appearance: { theme: "stripe", variables: { colorPrimary: "#14b8a6" } },
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900">Confirm and pay</h3>
        <p className="mt-1 text-sm text-gray-600">
          Your clean is paid for now and scheduled straight away.
        </p>
      </div>

      {amountInCents !== null && !error && (
        <div className="flex items-baseline justify-between rounded-lg bg-gray-50 border border-gray-200 px-4 py-3">
          <span className="text-sm font-medium text-gray-700">
            Charged today
          </span>
          <span className="text-lg font-semibold text-gray-900">
            ${(amountInCents / 100).toFixed(2)}
          </span>
        </div>
      )}

      {error && (
        <div className="space-y-3">
          <div className="p-4 bg-yellow-50 text-yellow-900 border border-yellow-200 rounded-md text-sm flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div>
              <p>{error}</p>
              {earliestDate && (
                <p className="mt-2">
                  The earliest date we can take is{" "}
                  <strong>
                    {new Date(`${earliestDate}T12:00:00`).toLocaleDateString(
                      "en-US",
                      { weekday: "long", month: "long", day: "numeric" }
                    )}
                  </strong>
                  . Go back a step to choose it.
                </p>
              )}
              <p className="mt-2">
                Need this sooner, or need a hand? Email{" "}
                <a
                  className="font-medium underline"
                  href="mailto:support@cleannami.com"
                >
                  support@cleannami.com
                </a>
                .
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void initializePayment()}
            disabled={isInitializing}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {isInitializing ? "Retrying…" : "Try again"}
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
            <div className="animate-spin h-10 w-10 rounded-full border-[3px] border-gray-200 border-t-teal-500" />
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
            This is a one-time clean — there is no subscription and nothing
            recurring.
          </p>
        </div>
      </div>
    </div>
  );
};
