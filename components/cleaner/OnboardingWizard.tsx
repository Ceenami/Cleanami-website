"use client";

import { useState } from "react";
import { Loader } from "lucide-react";
import { cn } from "@/lib/utils";

type OnboardingState = {
  step: number;
  phone: string;
  address: string;
  experienceYears: string;
  hasHotTubCert: boolean;
  legalDocsAcknowledged: boolean;
  onboardingCompleted: boolean;
  stripeOnboardingComplete: boolean;
  stripePayoutsEnabled: boolean;
};

const STEPS = [
  "Personal info",
  "Capabilities",
  "Documents",
  "Stripe payouts",
] as const;

export function OnboardingWizard({
  initial,
}: {
  initial: OnboardingState;
}) {
  const [step, setStep] = useState(initial.step || 1);
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [address, setAddress] = useState(initial.address ?? "");
  const [experienceYears, setExperienceYears] = useState(
    initial.experienceYears ?? ""
  );
  const [hasHotTubCert, setHasHotTubCert] = useState(
    initial.hasHotTubCert ?? false
  );
  const [legalDocsAcknowledged, setLegalDocsAcknowledged] = useState(
    initial.legalDocsAcknowledged ?? false
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stripeLoading, setStripeLoading] = useState(false);

  async function saveStep(
    nextStep: number,
    options?: { complete?: boolean; launchStripe?: boolean }
  ) {
    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/cleaner/onboarding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: nextStep,
          phone,
          address,
          experienceYears: experienceYears
            ? Number.parseInt(experienceYears, 10)
            : undefined,
          hasHotTubCert,
          legalDocsAcknowledged:
            options?.complete || legalDocsAcknowledged
              ? true
              : legalDocsAcknowledged,
          complete: options?.complete ?? false,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Could not save onboarding step");
      }

      if (options?.launchStripe) {
        setStripeLoading(true);
        const stripeResponse = await fetch("/api/cleaner/stripe-onboarding-link");
        const stripeData = await stripeResponse.json();
        if (!stripeResponse.ok) {
          throw new Error(stripeData.error ?? "Could not start Stripe onboarding");
        }
        window.location.href = stripeData.url;
        return;
      }

      setStep(nextStep);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
      setStripeLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Cleaner onboarding</h1>
        <p className="mt-1 text-sm text-gray-500">
          Complete all steps before accessing jobs, availability, and payouts.
        </p>
      </div>

      <ol className="flex flex-wrap gap-2">
        {STEPS.map((label, index) => {
          const stepNumber = index + 1;
          const active = step === stepNumber;
          const done = step > stepNumber;
          return (
            <li
              key={label}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium",
                active && "bg-brand text-white",
                done && "bg-green-100 text-green-800",
                !active && !done && "bg-gray-100 text-gray-600"
              )}
            >
              {label}
            </li>
          );
        })}
      </ol>

      {step === 1 && (
        <div className="space-y-4 rounded-xl border bg-white p-4 shadow-sm">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Phone
            </label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              placeholder="(555) 555-5555"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Home address
            </label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              placeholder="Street, city, state, zip"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Years of experience
            </label>
            <input
              type="number"
              min={0}
              value={experienceYears}
              onChange={(e) => setExperienceYears(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm"
            />
          </div>
          <button
            type="button"
            disabled={saving || !phone || !address}
            onClick={() => saveStep(2)}
            className="w-full rounded-lg bg-brand py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            Continue
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4 rounded-xl border bg-white p-4 shadow-sm">
          <label className="flex items-center justify-between">
            <span className="text-sm text-gray-700">Hot-tub capable</span>
            <button
              type="button"
              role="switch"
              aria-checked={hasHotTubCert}
              onClick={() => setHasHotTubCert((v) => !v)}
              className={cn(
                "relative h-6 w-11 rounded-full",
                hasHotTubCert ? "bg-brand" : "bg-gray-300"
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                  hasHotTubCert && "translate-x-5"
                )}
              />
            </button>
          </label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="flex-1 rounded-lg border py-3 text-sm font-medium"
            >
              Back
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => saveStep(3)}
              className="flex-1 rounded-lg bg-brand py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4 rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-600">
            Confirm you have reviewed and agree to the contractor documents:
            W-9, contractor agreement, liability waiver, and GPS consent.
          </p>
          <label className="flex items-start gap-3 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={legalDocsAcknowledged}
              onChange={(e) => setLegalDocsAcknowledged(e.target.checked)}
              className="mt-1"
            />
            <span>
              I agree to the required contractor documents and consent to GPS
              tracking during active jobs.
            </span>
          </label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="flex-1 rounded-lg border py-3 text-sm font-medium"
            >
              Back
            </button>
            <button
              type="button"
              disabled={saving || !legalDocsAcknowledged}
              onClick={() => saveStep(4, { complete: true, launchStripe: true })}
              className="flex-1 rounded-lg bg-brand py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              Continue to Stripe
            </button>
          </div>
        </div>
      )}

      {step >= 4 && (
        <div className="space-y-4 rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-600">
            Connect your Stripe Express account to receive payouts. You must
            complete this step before becoming eligible for assignments.
          </p>
          {initial.stripePayoutsEnabled ? (
            <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
              Stripe onboarding complete. You can access the cleaner portal.
            </div>
          ) : (
            <button
              type="button"
              disabled={stripeLoading || saving}
              onClick={() => saveStep(4, { launchStripe: true })}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {(stripeLoading || saving) && (
                <Loader className="h-4 w-4 animate-spin" />
              )}
              {stripeLoading || saving
                ? "Opening Stripe…"
                : "Continue Stripe setup"}
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
