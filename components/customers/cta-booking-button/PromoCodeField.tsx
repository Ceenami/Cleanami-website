"use client";

import React, { useState } from "react";
import { Tag, Check, X } from "lucide-react";
import { SignupFormData } from "@/lib/validations/bookng-modal";
import { serializeSignupFormDataForServer } from "@/lib/validations/bookng-modal/serialize-signup-form";

interface Props {
  formData: SignupFormData;
  /** Applied code, or "" to clear it. Drives the PaymentIntent amount. */
  onApply: (code: string) => void;
  /** Blocked while the PaymentIntent is being created or the payment is running. */
  disabled?: boolean;
}

type Applied = {
  code: string;
  discountCents: number;
  finalAmountCents: number;
  capped: boolean;
};

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * Promo code entry at checkout (task 1.8).
 *
 * The preview here is exactly that — a preview. The code is re-resolved
 * server-side when the PaymentIntent is created, so this component cannot
 * cause a wrong charge, only a wrong-looking one; that is why applying a code
 * re-creates the intent rather than adjusting a displayed number.
 */
export const PromoCodeField = ({ formData, onApply, disabled }: Props) => {
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<Applied | null>(null);

  const check = async () => {
    const trimmed = code.trim();
    if (!trimmed) return;

    setChecking(true);
    setError(null);

    try {
      const response = await fetch("/api/promo/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: trimmed,
          formData: serializeSignupFormDataForServer(formData),
        }),
      });

      const result = (await response.json()) as {
        valid: boolean;
        code?: string;
        discountCents?: number;
        finalAmountCents?: number;
        capped?: boolean;
        message?: string;
      };

      if (!result.valid || !result.code) {
        setError(result.message ?? "That promo code is not valid.");
        return;
      }

      setApplied({
        code: result.code,
        discountCents: result.discountCents ?? 0,
        finalAmountCents: result.finalAmountCents ?? 0,
        capped: result.capped ?? false,
      });
      setCode(result.code);
      onApply(result.code);
    } catch (fetchError) {
      console.error("Promo code check failed:", fetchError);
      setError("Could not check that code. Please try again.");
    } finally {
      setChecking(false);
    }
  };

  const remove = () => {
    setApplied(null);
    setCode("");
    setError(null);
    onApply("");
  };

  if (applied) {
    return (
      <div className="rounded-lg border border-teal-200 bg-teal-50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Check className="mt-0.5 h-5 w-5 flex-shrink-0 text-teal-600" />
            <div>
              <p className="text-sm font-medium text-teal-900">
                {applied.code} applied — {money(applied.discountCents)} off your
                first clean
              </p>
              <p className="mt-0.5 text-sm text-teal-800">
                First clean today: {money(applied.finalAmountCents)}
              </p>
              {applied.capped && (
                <p className="mt-1 text-xs text-teal-700">
                  This code is worth more than the remaining balance, so it has
                  been applied down to the minimum chargeable amount.
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={remove}
            disabled={disabled}
            className="flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-900 disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
            Remove
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <label
        htmlFor="promo-code"
        className="flex items-center gap-2 text-sm font-medium text-gray-700"
      >
        <Tag className="h-4 w-4 text-gray-400" />
        Have a promo code?
      </label>
      <div className="mt-2 flex gap-2">
        <input
          id="promo-code"
          type="text"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void check();
            }
          }}
          placeholder="Enter code"
          autoComplete="off"
          spellCheck={false}
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm uppercase tracking-wide text-gray-800 placeholder:normal-case placeholder:tracking-normal focus:border-teal-500 focus:outline-none focus:ring-teal-500"
        />
        <button
          type="button"
          onClick={() => void check()}
          disabled={checking || disabled || !code.trim()}
          className="rounded-md bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-900 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {checking ? "Checking…" : "Apply"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
};
