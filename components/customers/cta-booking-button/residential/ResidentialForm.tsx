"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader } from "lucide-react";
import { toast } from "sonner";

import { ModalLayout } from "../ModalLayout";
import { ProgressBar } from "../ProgressBar";
import { PriceSummary } from "../PriceSummary";
import { ResumeSessionPrompt } from "../../ResumeSessionPrompt";
import { R1YourDetails } from "./R1YourDetails";
import { R2YourHome } from "./R2YourHome";
import { R3When } from "./R3When";
import { R4GettingIn } from "./R4GettingIn";
import { R5Payment } from "./R5Payment";
import { R6Confirmation } from "./R6Confirmation";
import { BookingServiceHeader } from "../BookingServiceHeader";

import { cn } from "@/lib/utils";
import { isServiceUnavailableMessage } from "@/lib/env/messages";
import { useResidentialSession } from "@/hooks/useResidentialSession";
import {
  residentialFormSchema,
  type ResidentialFormData,
} from "@/lib/validations/residential";
import { serializeResidentialFormForServer } from "@/lib/validations/residential/serialize";
import type { PriceDetails } from "@/lib/validations/bookng-modal";
import { CUSTOM_QUOTE_RESIDENTIAL_MESSAGE } from "@/lib/pricing/custom-quote-message";
import type { ArrivalWindowKey } from "@/lib/scheduling/arrival-windows";
import { trackPaidBooking, type BookingConversion } from "@/lib/analytics";

/**
 * The residential one-time wizard — counterproposal item 4.
 *
 * Five steps and a confirmation. **No iCal, no subscription term, no 30-day
 * minimum, no guest check-in / check-out, and no turnover language anywhere in
 * the copy.** It is its own state machine rather than a mode of `SignupForm`
 * for the same reason it has its own schema: the two flows share a price
 * engine, not a form.
 *
 * It shares every visual component it can — `ModalLayout`, `ProgressBar`,
 * `PriceSummary`, `RadioCard`, `AddressAutocomplete`, `CheckoutForm`,
 * `AccessFields`, `PetsField`, `ResumeSessionPrompt` — and passes copy in as
 * props where a component was hard-wired to vacation-rental wording. There is
 * no second design system here.
 */

const TOTAL_STEPS = 6;
const CONFIRMATION_STEP = 6;

const stepTitles = [
  "Your Details",
  "Your Home",
  "When",
  "Getting In",
  "Payment",
  "Confirmation",
];

const RESUME_STEP_NAMES: Record<number, string> = {
  1: "Your Details",
  2: "Your Home",
  3: "When",
  4: "Getting In",
  5: "Payment",
};

const stepFields: Record<number, string[]> = {
  1: ["name", "email", "emailConfirm", "phoneNumber"],
  2: [
    "cleaningLevel",
    "address",
    "isAddressInServiceArea",
    "sqft",
    "bedrooms",
    "bathrooms",
  ],
  3: ["cleanDate", "arrivalWindow"],
  // R4 is entirely optional (items 5 and 6 are optional on both flows), so it
  // has no required fields — a customer who will let the cleaner in themselves
  // walks straight through.
  4: [],
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Present only when the service-type question is enabled. */
  onChangeServiceType?: () => void;
  initialData?: { formData: ResidentialFormData; currentStep: number };
}

export const ResidentialForm = ({
  isOpen,
  onClose,
  onChangeServiceType,
  initialData,
}: Props) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<ResidentialFormData>({
    name: "",
    email: "",
    emailConfirm: "",
    phoneNumber: "",
    address: "",
    sqft: 1500,
    bedrooms: 3,
    bathrooms: 2,
    petsAllowed: false,
    hotTub: "none",
    inUnitLaundryLoads: 0,
    isAddressInServiceArea: false,
  });
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>(
    {},
  );

  const [priceDetails, setPriceDetails] = useState<PriceDetails | null>(null);
  const [quoteRefusal, setQuoteRefusal] = useState<string | null>(null);
  const [pricedSnapshot, setPricedSnapshot] = useState<string | null>(null);
  const [arrivalWindowKeys, setArrivalWindowKeys] = useState<
    ArrivalWindowKey[]
  >([]);
  const [quoteRetry, setQuoteRetry] = useState(0);
  const [quoteFailed, setQuoteFailed] = useState(false);

  const [paymentData, setPaymentData] = useState<{
    paymentIntentId: string;
    amountInCents: number | null;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isChangingServiceType, setIsChangingServiceType] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [portalInviteEmailSent, setPortalInviteEmailSent] = useState(true);

  const onSessionLoaded = useCallback(
    (data: { formData: ResidentialFormData; currentStep: number }) => {
      setFormData((prev) => ({ ...prev, ...data.formData }));
      // Never resume onto the confirmation step: that session's booking is
      // already paid for, and re-entering the wizard there would show a
      // "booked" screen with no payment behind it.
      setCurrentStep(Math.max(1, Math.min(data.currentStep, TOTAL_STEPS - 1)));
    },
    [],
  );

  const {
    isLoadingSession,
    hasExistingSession,
    existingSessionData,
    acceptExistingSession,
    startFreshSession,
    saveProgress,
    saveProgressNow,
  } = useResidentialSession({ debounceMs: 1500, onSessionLoaded, skipInitialLoad: !!initialData });

  useEffect(() => {
    if (initialData) onSessionLoaded(initialData);
  }, [initialData, onSessionLoaded]);

  useEffect(() => {
    if (hasExistingSession || isLoadingSession) return;
    saveProgress(formData, currentStep);
  }, [
    formData,
    currentStep,
    saveProgress,
    hasExistingSession,
    isLoadingSession,
  ]);

  // The snapshot the quote is fetched for. The residential quote is more than a
  // price — the server answers "can we sell this at all?", because a home can
  // price fine and still be unstaffable.
  const quoteSnapshot = useMemo(
    () =>
      JSON.stringify({
        bedrooms: formData.bedrooms,
        bathrooms: formData.bathrooms,
        sqft: formData.sqft,
        cleaningLevel: formData.cleaningLevel,
        petsAllowed: formData.petsAllowed,
        hotTub: formData.hotTub ?? "none",
        inUnitLaundryLoads: formData.inUnitLaundryLoads ?? 0,
      }),
    [
      formData.bedrooms,
      formData.bathrooms,
      formData.sqft,
      formData.cleaningLevel,
      formData.petsAllowed,
      formData.hotTub,
      formData.inUnitLaundryLoads,
    ],
  );

  useEffect(() => {
    let superseded = false;
    const snapshot = quoteSnapshot;
    setPriceDetails(null);
    setPricedSnapshot(null);
    setQuoteRefusal(null);
    setQuoteFailed(false);
    setArrivalWindowKeys([]);

    const timerId = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch("/api/residential/quote", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: snapshot,
          });
          if (superseded) return;
          if (!res.ok) throw new Error("Quote unavailable");

          const result = (await res.json()) as {
            refused?: boolean;
            ruleVersion?: "residential-v1" | "residential-v2";
            reason?: string;
            message?: string;
            priceDetails?: PriceDetails;
            arrivalWindowKeys?: ArrivalWindowKey[];
          };
          if (superseded) return;

          if (result.refused) {
            // A shape problem ("you have not chosen a date yet") is not a
            // refusal worth showing — the form is simply incomplete. Only the
            // decisions that mean "we cannot sell this home a clean online"
            // replace the price.
            const isSellability =
              result.reason === "custom_quote" ||
              result.reason === "pricing_unavailable" ||
              result.reason === "no_window";
            setQuoteRefusal(isSellability ? (result.message ?? null) : null);
            setPriceDetails(null);
          } else if (result.priceDetails) {
            if (result.ruleVersion)
              setFormData((prev) =>
                prev.pricingVersion === result.ruleVersion
                  ? prev
                  : { ...prev, pricingVersion: result.ruleVersion },
              );
            setQuoteRefusal(null);
            setPriceDetails(result.priceDetails);
            setArrivalWindowKeys(result.arrivalWindowKeys ?? []);
          }
          setPricedSnapshot(snapshot);
        } catch {
          if (superseded) return;
          setPriceDetails(null);
          setArrivalWindowKeys([]);
          setQuoteFailed(true);
          setQuoteRefusal(
            "We could not update your price. Check your connection and try again.",
          );
        }
      })();
    }, 250);

    return () => {
      superseded = true;
      clearTimeout(timerId);
    };
  }, [quoteSnapshot, quoteRetry]);

  const isPriceStale = pricedSnapshot !== quoteSnapshot;

  const handleStepChange = async (newStep: number) => {
    setCurrentStep(newStep);
    await saveProgressNow(formData, newStep);
  };

  const validateStep = (step: number) => {
    const fields = stepFields[step];
    if (!fields || fields.length === 0) {
      setErrors({});
      return true;
    }

    const result = residentialFormSchema.safeParse(formData);
    if (result.success) {
      setErrors({});
      return true;
    }

    const fieldErrors = result.error.flatten().fieldErrors as Record<
      string,
      string[] | undefined
    >;
    const stepErrors: Record<string, string[] | undefined> = {};
    let hasError = false;
    fields.forEach((field) => {
      if (fieldErrors[field]) {
        stepErrors[field] = fieldErrors[field];
        hasError = true;
      }
    });
    setErrors(stepErrors);
    return !hasError;
  };

  const nextStep = () => {
    // A home we cannot price or cannot staff never reaches the payment step.
    // The refusal is shown where the price would be; there is nothing to
    // continue to, so the button simply does not advance.
    if (quoteRefusal || (currentStep >= 2 && (isPriceStale || !priceDetails)))
      return;
    if (validateStep(currentStep)) {
      void handleStepChange(Math.min(currentStep + 1, TOTAL_STEPS));
    }
  };

  const prevStep = () => {
    setErrors({});
    void handleStepChange(Math.max(currentStep - 1, 1));
  };

  const handlePaymentSuccess = async (
    paymentIntentId: string,
    chargedAmountCents: number | null,
  ) => {
    setPaymentData({
      paymentIntentId,
      // What was actually charged. Falling back to the list price is only for
      // the case where the payment step never reported an amount; a promo code
      // makes those two numbers different, and the confirmation must not quote
      // a total the customer was not charged.
      amountInCents:
        chargedAmountCents ??
        (priceDetails ? Math.round(priceDetails.totalPerClean * 100) : null),
    });
    setIsSaving(true);
    setSaveError(null);

    try {
      const response = await fetch("/api/residential/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentIntentId,
          formData: serializeResidentialFormForServer(formData),
        }),
      });

      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
        data?: { portalInviteEmailSent?: boolean; tracking?: BookingConversion };
      };

      if (response.ok && result.success) {
        // Server-confirmed paid booking; measurement cannot delay session cleanup/confirmation.
        trackPaidBooking(result.data?.tracking);
        if (result.data?.tracking) setPaymentData({
          paymentIntentId, amountInCents: result.data.tracking.amountCents,
        });
        setPortalInviteEmailSent(result.data?.portalInviteEmailSent !== false);
        try {
          await fetch("/api/onboarding/session", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ complete: true }),
          });
        } catch {
          // ignore
        }
        setCurrentStep(CONFIRMATION_STEP);
        return;
      }

      if (result.error && isServiceUnavailableMessage(result.error)) {
        toast.error(result.error);
      }

      setSaveError(
        `Your payment was successful, but there was an issue finalizing your booking. Our team has been notified. For your records, your transaction ID is: ${paymentIntentId}. Please contact support if you have any questions.`,
      );
    } catch (error) {
      console.error("Residential booking finalize failed:", error);
      setSaveError(
        `Your payment was successful, but we could not reach the server to finalize your booking. For your records, your transaction ID is: ${paymentIntentId}. Please contact support.`,
      );
    } finally {
      setIsSaving(false);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return (
          <R1YourDetails
            formData={formData}
            setFormData={setFormData}
            errors={errors}
          />
        );
      case 2:
        return (
          <R2YourHome
            formData={formData}
            setFormData={setFormData}
            errors={errors}
          />
        );
      case 3:
        return (
          <R3When
            arrivalWindowKeys={arrivalWindowKeys}
            formData={formData}
            setFormData={setFormData}
            errors={errors}
          />
        );
      case 4:
        return (
          <R4GettingIn
            formData={formData}
            setFormData={setFormData}
            errors={errors}
          />
        );
      case 5:
        return (
          <div>
            <R5Payment
              formData={formData}
              setFormData={setFormData}
              onPaymentSuccess={handlePaymentSuccess}
              paymentFinalizing={isSaving}
              quoteReady={!isPriceStale && !!priceDetails && !quoteRefusal}
            />
            {isSaving && (
              <p className="text-center mt-4 text-sm text-gray-500 animate-pulse">
                Finalizing your booking...
              </p>
            )}
            {saveError && (
              <p className="text-center mt-4 text-sm text-red-600">
                {saveError}
              </p>
            )}
          </div>
        );
      case CONFIRMATION_STEP:
        return (
          <R6Confirmation
            cleaningLevel={formData.cleaningLevel}
            pricingVersion={formData.pricingVersion}
            hotTub={formData.hotTub}
            inUnitLaundryLoads={formData.inUnitLaundryLoads}
            paymentIntentId={paymentData?.paymentIntentId}
            amountInCents={paymentData?.amountInCents}
            promoCode={formData.promoCode ?? null}
            cleanDate={formData.cleanDate}
            arrivalWindow={formData.arrivalWindow}
            portalInviteEmailSent={portalInviteEmailSent}
          />
        );
      default:
        return null;
    }
  };

  const isConfirmation = currentStep === CONFIRMATION_STEP;
  const showPriceSummary = currentStep >= 2 && !isConfirmation;
  const canChangeService = !!onChangeServiceType && currentStep < 5 && !isSaving && !paymentData;
  const changeService = async () => {
    if (isChangingServiceType) return;
    setIsChangingServiceType(true);
    try {
      if (!isLoadingSession && !hasExistingSession) {
        const saved = await saveProgressNow(formData, currentStep);
        if (!saved) {
          toast.error("We could not save your progress. Please try changing the cleaning type again.");
          return;
        }
      }
      onChangeServiceType?.();
    } finally {
      setIsChangingServiceType(false);
    }
  };

  // A refusal replaces the price entirely rather than sitting beside it. The
  // component already renders a custom-quote card, so feeding it a null price
  // with the residential CTA reuses that surface instead of adding another.
  const summary = (
    <PriceSummary
      priceDetails={
        quoteRefusal
          ? ({
              isCustomQuote: true,
              pricingUnavailable: false,
              laundryLoadsMissing: false,
            } as PriceDetails)
          : priceDetails
      }
      isRecalculating={isPriceStale}
      title="Your Price"
      totalLabel="Total for this clean"
      customQuoteMessage={quoteRefusal ?? CUSTOM_QUOTE_RESIDENTIAL_MESSAGE}
    />
  );

  const renderContent = () => {
    if (isLoadingSession) {
      return (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader className="w-8 h-8 text-brand animate-spin" />
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      );
    }

    if (hasExistingSession && existingSessionData?.success) {
      return (
        <ResumeSessionPrompt
          currentStep={existingSessionData.currentStep ?? 1}
          email={existingSessionData.formData?.email}
          onContinue={acceptExistingSession}
          onStartFresh={startFreshSession}
          stepNames={RESUME_STEP_NAMES}
        />
      );
    }

    return (
      <>
        {!isConfirmation && (
          <div className="mb-6">
            <ProgressBar
              currentStep={currentStep}
              totalSteps={TOTAL_STEPS - 1}
              stepLabels={stepTitles.slice(0, -1)}
            />
          </div>
        )}

        {showPriceSummary && <div className="md:hidden mb-6">{summary}</div>}

        <div>
          <div>{renderStep()}</div>
          {quoteFailed && (
            <button
              type="button"
              className="mt-3 text-sm font-medium text-teal-700"
              onClick={() => setQuoteRetry((retry) => retry + 1)}
            >
              Retry price
            </button>
          )}

          {!isConfirmation && (
            <div className="sticky bottom-0 z-10 mt-8 border-t bg-white/95 py-4 backdrop-blur">
              <div className="flex justify-between">
                <button
                  type="button"
                  onClick={prevStep}
                  disabled={currentStep === 1}
                  className={cn(
                    "py-2 px-4 rounded-md text-sm font-medium text-white bg-brand hover:bg-brand/60",
                    currentStep === 1 ? "invisible" : "visible",
                  )}
                >
                  Back
                </button>

                {currentStep < 5 && (
                  <button
                    type="button"
                    onClick={nextStep}
                    disabled={
                      !!quoteRefusal ||
                      (currentStep >= 2 && (isPriceStale || !priceDetails))
                    }
                    className="py-2 px-4 rounded-md text-sm font-medium text-white bg-brand hover:bg-brand/60 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </>
    );
  };

  return (
    <ModalLayout
      isOpen={isOpen}
      compact={!showPriceSummary || isLoadingSession || hasExistingSession}
      onClose={onClose}
      title={
        isLoadingSession
          ? "Loading..."
          : hasExistingSession
            ? "Welcome Back"
            : stepTitles[currentStep - 1]
      }
      showPriceSummary={
        showPriceSummary && !isLoadingSession && !hasExistingSession
      }
      priceDetails={
        quoteRefusal
          ? ({
              isCustomQuote: true,
              pricingUnavailable: false,
              laundryLoadsMissing: false,
            } as PriceDetails)
          : priceDetails
      }
      isPriceRecalculating={isPriceStale}
      priceSummaryTitle="Your Price"
      priceSummaryTotalLabel="Total for this clean"
      priceSummaryCustomQuoteMessage={
        quoteRefusal ?? CUSTOM_QUOTE_RESIDENTIAL_MESSAGE
      }
    >
      {!isConfirmation && (
        <BookingServiceHeader serviceType="residential_one_time" onChange={canChangeService ? changeService : undefined} isChanging={isChangingServiceType} />
      )}
      {renderContent()}
    </ModalLayout>
  );
};
