"use client";

import {
  PriceDetails,
  SignupFormData,
  signupFormSchema,
} from "@/lib/validations/bookng-modal";
import React, { useState, useEffect, useMemo } from "react";
import { Step1CustomerInfo } from "./Step1CustomerInfo";
import { Step2PropertyInfo } from "./Step2PropertyInfo";
import { Step3Checklist } from "./Step3Checklist";
import { Step4Addons } from "./Step4Addons";
import { Step5Subscription } from "./Step5Subscription";
import { Step6Calendar } from "./Step6Calendar";
import { Step7Payment } from "./Step7Payment";
import { Step8Confirmation } from "./Step8Confirmation";
import { ModalLayout } from "./ModalLayout";
import { ProgressBar } from "./ProgressBar";
import { PriceSummary } from "./PriceSummary";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { isServiceUnavailableMessage } from "@/lib/env/messages";
import { serializeSignupFormDataForServer } from "@/lib/validations/bookng-modal/serialize-signup-form";
import { getSubscriptionDiscountRate } from "@/lib/pricing/subscription-discount";

// Session persistence
import { useSessionPersistence } from "@/hooks/useSessionPersistence";
import { ResumeSessionPrompt } from "../ResumeSessionPrompt";
import { Loader } from "lucide-react";
import { CallBookedConfirmation } from "@/components/CallBookedConfirmation";

const stepFields: Record<number, string[]> = {
  1: ["name", "email", "emailConfirm", "phoneNumber"],
  2: ["address", "bedrooms", "sqft", "bathrooms", "isAddressInServiceArea", "defaultCheckInTime", "defaultCheckOutTime"],
  5: ["subscriptionMonths", "firstCleanDate"],
  6: ["iCalUrl"],
};

const stepTitles = [
  "Customer Info",
  "Property Details",
  "Cleaning Checklist",
  "Service Add-ons",
  "Subscription & Start Date",
  "Calendar Sync",
  "Payment",
  "Confirmation",
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Pre-loaded data from resume link verification */
  initialData?: {
    formData: Partial<SignupFormData>;
    currentStep: number;
    priceDetails: PriceDetails | null;
  };
}

const TOTAL_STEPS = 8;

export const SignupForm = ({ isOpen, onClose, initialData }: Props) => {
  const [paymentData, setPaymentData] = useState<{
    paymentIntentId: string;
    amount: number;
    currency: string;
  } | null>(null);

  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<SignupFormData>({
    name: "",
    email: "",
    emailConfirm: "",
    phoneNumber: "",
    address: "",
    sqft: 900,
    bedrooms: 2,
    bathrooms: 1,
    checklistFile: undefined,
    useDefaultChecklist: false,
    laundryService: "none",
    laundryLoads: 1,
    hasHotTub: false,
    hotTubService: false,
    hotTubDrain: false,
    hotTubDrainCadence: undefined,
    subscriptionMonths: 1,
    iCalUrl: "",
    defaultCheckInTime: '16:00:00',
    defaultCheckOutTime: '09:00:00',
    isAddressInServiceArea: false,
    // @ts-expect-error: null is needed to prevent calendar from proceeding on invalid options
    firstCleanDate: null,
  });
  const [priceDetails, setPriceDetails] = useState<PriceDetails | null>(null);
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [portalInviteEmailSent, setPortalInviteEmailSent] = useState(true);

  // Call booking state
  const [showCallBookedConfirmation, setShowCallBookedConfirmation] = useState(false);

  // Whether the payment step has revealed the Stripe card form. Lives here so
  // the footer can offer "Activate Your Subscription" next to Back — the last
  // step previously had no obvious forward action at all, only the Founder
  // Card's "Continue setup on your own".
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const revealPaymentForm = () => setShowPaymentForm(true);

  // Load initialData if provided (from resume link verification)
  useEffect(() => {
    if (initialData) {
      setFormData((prev) => ({ ...prev, ...initialData.formData }));
      setCurrentStep(initialData.currentStep);
      if (initialData.priceDetails) {
        setPriceDetails(initialData.priceDetails);
      }
    }
  }, [initialData]);

  // Session persistence
  const {
    isLoadingSession,
    hasExistingSession,
    existingSessionData,
    acceptExistingSession,
    startFreshSession,
    saveProgress,
    saveProgressNow,
  } = useSessionPersistence({
    debounceMs: 1500,
    // Skip session loading if we already have initialData
    onSessionLoaded: initialData ? undefined : (data) => {
      setFormData((prev) => ({ ...prev, ...data.formData }));
      setCurrentStep(data.currentStep);
      if (data.priceDetails) {
        setPriceDetails(data.priceDetails);
      }
    },
  });

  // Autosave on form data changes (debounced)
  useEffect(() => {
    if (hasExistingSession || isLoadingSession) return;
    saveProgress(formData, currentStep, priceDetails);
  }, [formData, currentStep, priceDetails, saveProgress, hasExistingSession, isLoadingSession]);

  const pricingFormSnapshot = useMemo(
    () => JSON.stringify(serializeSignupFormDataForServer(formData)),
    [formData]
  );

  /** The snapshot `priceDetails` was actually calculated for. */
  const [pricedSnapshot, setPricedSnapshot] = useState<string | null>(null);

  // Fetch price when form data changes.
  //
  // The displayed price must never disappear or go backwards: a failed request
  // leaves the previous price on screen, and a slow response that is overtaken
  // by a newer one is discarded rather than clobbering the fresher value.
  useEffect(() => {
    let superseded = false;
    const snapshot = pricingFormSnapshot;

    const fetchPrice = async () => {
      try {
        const res = await fetch("/api/pricing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: snapshot,
        });
        if (superseded) return;
        if (res.ok) {
          const details = (await res.json()) as PriceDetails | null;
          if (!superseded && details) {
            setPriceDetails(details);
            setPricedSnapshot(snapshot);
          }
        }
      } catch {
        // Price fetch errors are non-fatal — keep showing the last good price.
      }
    };

    const timerId = setTimeout(() => {
      void fetchPrice();
    }, 250);

    return () => {
      superseded = true;
      clearTimeout(timerId);
    };
  }, [pricingFormSnapshot]);

  // What the summary actually shows.
  //
  // The subscription-term discount is a pure function of the term length
  // (`getSubscriptionDiscountRate`, the same module the server prices with), so
  // re-deriving it here makes picking a longer term update the total instantly
  // instead of a round trip later — the lag that let a customer hit Continue
  // while the calculator still showed the old number. Everything the server
  // owns (base price, surcharges, add-ons) is left exactly as returned.
  const displayedPriceDetails = useMemo<PriceDetails | null>(() => {
    if (!priceDetails) return null;

    const discountRate = getSubscriptionDiscountRate(
      Number(formData.subscriptionMonths) || 1
    );
    if (discountRate === priceDetails.discountRate) return priceDetails;

    const discountAmount =
      Math.round(priceDetails.subtotalPerClean * discountRate * 100) / 100;

    return {
      ...priceDetails,
      discountRate,
      discountAmount,
      totalPerClean: priceDetails.subtotalPerClean - discountAmount,
    };
  }, [priceDetails, formData.subscriptionMonths]);

  // True while the numbers on screen do not yet reflect the current answers, so
  // the summary can say so instead of silently showing a stale price.
  const isPriceStale =
    pricedSnapshot !== null && pricedSnapshot !== pricingFormSnapshot;

  // Step change handler (saves immediately)
  const handleStepChange = async (newStep: number) => {
    setCurrentStep(newStep);
    await saveProgressNow(formData, newStep, priceDetails);
  };

  // Validation
  const validateStep = (step: number) => {
    if (step === 3) {
      const useDefault = formData.useDefaultChecklist;
      const hasFile = formData.checklistFile && formData.checklistFile.length > 0;
      const hasSheetUrl = !!formData.checklistSheetUrl;
      if (useDefault || hasFile || hasSheetUrl) {
        setErrors({});
        return true;
      }
      setErrors({
        checklistFile: ["Please upload a checklist, paste a link, or select the default option."],
      });
      return false;
    }

    if (step === 4) {
      // Addons. A laundry service without a load count would price laundry at
      // $0 and save the property with a null load count, so require it here —
      // before the card is touched. `signupFormSchema` cannot enforce this for
      // us: its only server-side parse runs in complete-onboarding, which is
      // AFTER the charge, so a rejection there strands a paid customer.
      const needsLoads =
        formData.laundryService === "in_unit" ||
        formData.laundryService === "off_site";
      const loads = Number(formData.laundryLoads);

      if (needsLoads && !(Number.isInteger(loads) && loads >= 1)) {
        setErrors({
          laundryLoads: [
            "Enter how many loads per turnover (at least 1), or choose no laundry service.",
          ],
        });
        return false;
      }

      setErrors({});
      return true;
    }

    const fieldsToValidate = stepFields[step];
    if (!fieldsToValidate) {
      setErrors({});
      return true;
    }

    const result = signupFormSchema.partial().safeParse(formData);
    if (result.success) {
      setErrors({});
      return true;
    }

    const fieldErrors = result.error.flatten().fieldErrors;
    const currentStepErrors: Record<string, string[] | undefined> = {};
    let hasErrorOnStep = false;
    fieldsToValidate.forEach((field) => {
      if (fieldErrors[field as keyof SignupFormData]) {
        currentStepErrors[field] = fieldErrors[field as keyof SignupFormData];
        hasErrorOnStep = true;
      }
    });
    setErrors(currentStepErrors);
    return !hasErrorOnStep;
  };

  const nextStep = () => {
    if (validateStep(currentStep)) {
      handleStepChange(Math.min(currentStep + 1, TOTAL_STEPS));
    }
  };

  const prevStep = () => {
    setErrors({});
    handleStepChange(Math.max(currentStep - 1, 1));
  };

  // Call booking handler
  const handleBookCall = async () => {
    await saveProgressNow(formData, currentStep, priceDetails);
    try {
      const res = await fetch("/api/onboarding/session", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_call_booked" }),
      });
      const result = (await res.json()) as { success?: boolean; error?: string };
      if (result.success) {
        setShowCallBookedConfirmation(true);
      } else if (result.error && isServiceUnavailableMessage(result.error)) {
        toast.error(result.error);
      }
    } catch {
      // non-fatal
      setShowCallBookedConfirmation(true);
    }
  };

  // Continue after viewing Founder Card (just proceeds to next step)
  const handleContinueSetup = () => {
    nextStep();
  };

  // Payment success handler
  const handlePaymentSuccess = async (paymentIntentId: string) => {
    setPaymentData({
      paymentIntentId,
      amount: displayedPriceDetails?.totalPerClean || 0,
      currency: "CHF",
    });
    setIsSaving(true);
    setSaveError(null);

    try {
      const body = new FormData();
      body.append("paymentIntentId", paymentIntentId);
      body.append(
        "formData",
        JSON.stringify(serializeSignupFormDataForServer(formData))
      );

      if (formData.checklistFile?.length) {
        for (const file of formData.checklistFile) {
          body.append("checklistFiles", file);
        }
      }

      const response = await fetch("/api/customer/onboarding/complete", {
        method: "POST",
        body,
      });

      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
        data?: { portalInviteEmailSent?: boolean };
      };

      if (response.ok && result.success) {
        setPortalInviteEmailSent(result.data?.portalInviteEmailSent !== false);
        // Complete the onboarding session (non-fatal if it fails)
        try {
          await fetch("/api/onboarding/session", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ complete: true }),
          });
        } catch {
          // ignore
        }
        setCurrentStep(TOTAL_STEPS);
        return;
      }

      if (result.error && isServiceUnavailableMessage(result.error)) {
        toast.error(result.error);
      }

      setSaveError(
        `Your payment was successful, but there was an issue finalizing your subscription. Our team has been notified. For your records, your transaction ID is: ${paymentIntentId}. Please contact support if you have any questions.`
      );
    } catch (error) {
      console.error("Onboarding finalize failed:", error);
      setSaveError(
        `Your payment was successful, but we could not reach the server to finalize your subscription. For your records, your transaction ID is: ${paymentIntentId}. Please contact support.`
      );
    } finally {
      setIsSaving(false);
    }
  };

  // Render current step
  const renderStep = () => {
    // Common props for steps with Founder Card
    const founderCardProps = {
      onBookCall: handleBookCall,
      onContinueSetup: handleContinueSetup,
    };

    switch (currentStep) {
      case 1:
        return (
          <Step1CustomerInfo
            formData={formData}
            setFormData={setFormData}
            errors={errors}
          />
        );
      case 2:
        return (
          <Step2PropertyInfo
            formData={formData}
            setFormData={setFormData}
            errors={errors}
            showFounderCard={!!priceDetails && priceDetails.totalPerClean > 0}
            {...founderCardProps}
          />
        );
      case 3:
        return (
          <Step3Checklist
            formData={formData}
            setFormData={setFormData}
            errors={errors}
            {...founderCardProps}
          />
        );
      case 4:
        return (
          <Step4Addons
            formData={formData}
            setFormData={setFormData}
            errors={errors}
          />
        );
      case 5:
        return (
          <Step5Subscription
            formData={formData}
            setFormData={setFormData}
            errors={errors}
            {...founderCardProps}
          />
        );
      case 6:
        return (
          <Step6Calendar
            formData={formData}
            setFormData={setFormData}
            errors={errors}
            {...founderCardProps}
          />
        );
      case 7:
        return (
          <div>
            <Step7Payment
              priceDetails={displayedPriceDetails}
              formData={formData}
              setFormData={setFormData}
              onPaymentSuccess={handlePaymentSuccess}
              paymentFinalizing={isSaving}
              showPaymentForm={showPaymentForm}
              onShowPaymentForm={revealPaymentForm}
              {...founderCardProps}
            />
            {isSaving && (
              <p className="text-center mt-4 text-sm text-gray-500 animate-pulse">
                Finalizing your subscription...
              </p>
            )}
            {saveError && (
              <p className="text-center mt-4 text-sm text-red-600">{saveError}</p>
            )}
          </div>
        );
      case 8:
        return (
          <Step8Confirmation
            paymentIntentId={paymentData?.paymentIntentId}
            amount={paymentData?.amount}
            currency={paymentData?.currency}
            portalInviteEmailSent={portalInviteEmailSent}
          />
        );
      default:
        return null;
    }
  };

  const isConfirmation = currentStep === TOTAL_STEPS;
  const showPriceSummary = currentStep >= 2 && currentStep < TOTAL_STEPS;

  // Render main content
  const renderContent = () => {
    // Skip loading state if we have initialData (already verified via resume link)
    if (isLoadingSession && !initialData) {
      return (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader className="w-8 h-8 text-brand animate-spin" />
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      );
    }

    // Skip resume prompt if we have initialData (already loaded via resume link)
    if (hasExistingSession && existingSessionData?.success && !initialData) {
      return (
        <ResumeSessionPrompt
          currentStep={existingSessionData.currentStep ?? 1}
          email={existingSessionData.formData?.email}
          onContinue={acceptExistingSession}
          onStartFresh={startFreshSession}
        />
      );
    }

    // Normal form flow
    return (
      <>
        {!isConfirmation && (
          <div className="mb-6">
            <ProgressBar currentStep={currentStep} totalSteps={TOTAL_STEPS - 1} />
          </div>
        )}

        {showPriceSummary && (
          <div className="md:hidden mb-6">
            <PriceSummary
              priceDetails={displayedPriceDetails}
              isRecalculating={isPriceStale}
            />
          </div>
        )}

        <div>
          <div className="min-h-[350px]">{renderStep()}</div>

          <div className="mt-8 pt-5 border-t">
            <div className="flex justify-between">
              <button
                type="button"
                onClick={prevStep}
                disabled={currentStep === 1}
                className={cn(
                  "py-2 px-4 rounded-md text-sm font-medium text-white bg-brand hover:bg-brand/60",
                  currentStep === 1 ? "invisible" : "visible"
                )}
              >
                Back
              </button>

              {!isConfirmation && currentStep < 7 && (
                <button
                  type="button"
                  onClick={nextStep}
                  className="py-2 px-4 rounded-md text-sm font-medium text-white bg-brand hover:bg-brand/60"
                >
                  Next
                </button>
              )}

              {/* Payment step: a named primary action, so it is never unclear
                  what finishes the booking. Once the card form is on screen its
                  own "Confirm & Pay" button takes over. */}
              {currentStep === 7 && !showPaymentForm && (
                <button
                  type="button"
                  onClick={revealPaymentForm}
                  className="py-2 px-4 rounded-md text-sm font-semibold text-white bg-brand hover:bg-brand/60"
                >
                  Activate Your Subscription
                </button>
              )}
            </div>
          </div>
        </div>
      </>
    );
  };

  return (
    <>
      <ModalLayout
        isOpen={isOpen}
        onClose={onClose}
        title={
          isLoadingSession
            ? "Loading..."
            : hasExistingSession
            ? "Welcome Back"
            : stepTitles[currentStep - 1]
        }
        showPriceSummary={showPriceSummary && !isLoadingSession && !hasExistingSession}
        priceDetails={displayedPriceDetails}
        isPriceRecalculating={isPriceStale}
      >
        {renderContent()}
      </ModalLayout>

      {/* Call Booked Confirmation Modal */}
      {showCallBookedConfirmation && (
        <CallBookedConfirmation
          email={formData.email}
          onContinue={() => {
            setShowCallBookedConfirmation(false);
            // They can continue where they left off
          }}
          onDismiss={() => {
            setShowCallBookedConfirmation(false);
            onClose(); // Close the main modal too
          }}
        />
      )}
    </>
  );
};