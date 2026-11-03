"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { SignupForm } from "./SignupForm";
import { ResidentialForm } from "./residential/ResidentialForm";
import { ServiceTypeChoice } from "./ServiceTypeChoice";
import { ModalLayout } from "./ModalLayout";
import { loadSession } from "@/lib/actions/session.actions";
import { SignupFormData, PriceDetails } from "@/lib/validations/bookng-modal";
import { ResumeVerification } from "@/components/ResumeVerification";
import { hasSavedBookingProgress, readSessionServiceType } from "@/lib/validations/booking-session";
import { isServiceTypeChoiceEnabled } from "@/lib/config/booking-flags";
import type { ServiceType } from "@/lib/constants/service-type";
import { SERVICE_TYPE_LABELS } from "@/lib/constants/service-type";
import { normalizeResidentialFormData } from "@/lib/validations/residential/serialize";

interface ResumeData {
  formData: Partial<SignupFormData>;
  currentStep: number;
  priceDetails: PriceDetails | null;
}

export const SignupModal = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showResumeVerification, setShowResumeVerification] = useState(false);
  const [resumeSessionId, setResumeSessionId] = useState<string | null>(null);
  const [resumeData, setResumeData] = useState<ResumeData | null>(null);
  const [savedService, setSavedService] = useState<ServiceType | null>(null);
  const [pendingService, setPendingService] = useState<ServiceType | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [isReplacingSession, setIsReplacingSession] = useState(false);
  const sessionRead = useRef(0);

  /**
   * `null` shows the service question, including for returning visitors.
   * When `NEXT_PUBLIC_SERVICE_TYPE_CHOICE` is off this is seeded to the
   * vacation-rental value and never becomes null, so the modal opens directly
   * on today's step 1 and the product is exactly what it is now
   * (`DELIVERY.md`'s rollback lever).
   */
  const serviceTypeChoiceEnabled = isServiceTypeChoiceEnabled();
  const [serviceType, setServiceType] = useState<ServiceType | null>(
    serviceTypeChoiceEnabled ? null : "vacation_rental_subscription"
  );
  /** Saved progress is context for the choice, never an automatic redirect. */
  const [isRoutingSession, setIsRoutingSession] = useState(false);

  const searchParams = useSearchParams();
  const router = useRouter();

  // Check for ?resume= parameter on mount
  useEffect(() => {
    const resumeParam = searchParams.get("resume");

    if (resumeParam) {
      // Check if we already have a valid cookie session for this
      loadSession().then((result) => {
        if (result.success && result.sessionId === resumeParam) {
          // Cookie matches - load directly without email verification
          setResumeData({
            formData: result.formData,
            currentStep: result.currentStep,
            priceDetails: result.priceDetails,
          });
          setServiceType(readSessionServiceType(result.formData as Record<string, unknown>) ?? "vacation_rental_subscription");
          setIsModalOpen(true);
        } else {
          // No matching cookie - need email verification
          setResumeSessionId(resumeParam);
          setShowResumeVerification(true);
          setIsModalOpen(true);
        }

        // Clean up URL
        const url = new URL(window.location.href);
        url.searchParams.delete("resume");
        router.replace(url.pathname + url.search, { scroll: false });
      });
    }
  }, [searchParams, router]);

  // Handle successful email verification
  const handleVerificationSuccess = useCallback((data: {
    formData: Record<string, unknown>;
    currentStep: number;
    priceDetails: Record<string, unknown> | null;
  }) => {
    setResumeData({
      formData: data.formData as Partial<SignupFormData>,
      currentStep: data.currentStep,
      priceDetails: data.priceDetails as PriceDetails | null,
    });
    setServiceType(readSessionServiceType(data.formData) ?? "vacation_rental_subscription");
    setShowResumeVerification(false);
  }, []);

  // Handle modal close
  const handleClose = useCallback(() => {
    if (isReplacingSession) return;
    setIsModalOpen(false);
    setShowResumeVerification(false);
    setResumeSessionId(null);
    sessionRead.current += 1;
  }, [isReplacingSession]);

  const readSavedSession = useCallback(async () => {
    const read = ++sessionRead.current;
    setIsRoutingSession(true);
    setSessionError(null);
    setPendingService(null);
    try {
      const response = await fetch("/api/onboarding/session", { cache: "no-store", signal: AbortSignal.timeout(10000) });
      const result = await response.json();
      if (!response.ok || (!result.success && !["No session found", "Session expired or completed"].includes(result.error))) throw new Error("Session unavailable");
      if (read !== sessionRead.current) return;
      const data = result.formData as Record<string, unknown> | undefined;
      const hasSavedAnswers = result.success && hasSavedBookingProgress(result);
      setSavedService(hasSavedAnswers ? readSessionServiceType(data) ?? "vacation_rental_subscription" : null);
    } catch {
      if (read === sessionRead.current) setSessionError("We could not check your saved progress. Please try again.");
    } finally {
      if (read === sessionRead.current) setIsRoutingSession(false);
    }
  }, []);

  // Cancelling link verification returns to the choice without deleting a draft.
  const handleVerificationCancel = useCallback(() => {
    setShowResumeVerification(false);
    setResumeSessionId(null);
    setResumeData(null);
    setServiceType(serviceTypeChoiceEnabled ? null : "vacation_rental_subscription");
    if (serviceTypeChoiceEnabled) void readSavedSession();
  }, [serviceTypeChoiceEnabled, readSavedSession]);

  // Handle modal open (from button click)
  const handleOpen = useCallback(() => {
    if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
    window.gtag('event', 'conversion', {
      send_to: 'AW-17499794760/NY5gCKPU594bEMjaxphB',
    });
  }
    setIsModalOpen(true);
    setResumeData(null);
    if (serviceTypeChoiceEnabled) {
      setServiceType(null);
      void readSavedSession();
    }
  }, [serviceTypeChoiceEnabled, readSavedSession]);

  /** Going back does not discard anything. Replacement needs an explicit choice. */
  const handleChangeServiceType = useCallback(() => {
    setResumeData(null);
    setServiceType(null);
    void readSavedSession();
  }, [readSavedSession]);

  const selectService = (selected: ServiceType) => {
    if (savedService && savedService !== selected) setPendingService(selected);
    else setServiceType(selected);
  };

  const replaceSavedSession = async () => {
    if (!pendingService || isReplacingSession) return;
    setIsReplacingSession(true);
    setSessionError(null);
    try {
      // POST creates a fresh form and replaces the cookie only on success.
      // Keep the original draft available if creating its replacement fails.
      const created = await fetch("/api/onboarding/session", { method: "POST", signal: AbortSignal.timeout(10000) });
      if (!created.ok || !(await created.json()).success) throw new Error("Create failed");
      setSavedService(null);
      setServiceType(pendingService);
      setPendingService(null);
    } catch {
      setSessionError("We could not start the new form. Please try again before continuing.");
    } finally {
      setIsReplacingSession(false);
    }
  };

  const showChoice =
    isModalOpen && !showResumeVerification && serviceType === null;

  return (
    <>
      <button
        onClick={handleOpen}
        className="px-6 py-3 bg-brand text-white font-semibold rounded-lg shadow-md hover:bg-brand/60 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:ring-opacity-75 transition-transform transform hover:scale-105"
      >
        Get Your Price Now!
      </button>

      {/* Resume Verification Modal */}
      {isModalOpen && showResumeVerification && resumeSessionId && (
        <ModalLayout
          isOpen={true}
          onClose={handleClose}
          title="Resume Your Setup"
          compact
          showPriceSummary={false}
          priceDetails={null}
        >
          <ResumeVerification
            sessionId={resumeSessionId}
            onSuccess={handleVerificationSuccess}
            onCancel={handleVerificationCancel}
          />
        </ModalLayout>
      )}

      {/* Item 2 — the service-type question, in front of both wizards. */}
      {showChoice && (
        <ModalLayout
          isOpen={true}
          onClose={handleClose}
          title="Get Your Price"
          compact={!!pendingService}
          showPriceSummary={false}
          priceDetails={null}
        >
          {pendingService ? (
            <div className="space-y-5">
              <h3 className="text-lg font-semibold text-gray-900">Start a {SERVICE_TYPE_LABELS[pendingService]}?</h3>
              <p className="text-sm text-gray-600">This replaces your saved booking form. You will enter the details for the new service from the beginning.</p>
              {sessionError && <p role="alert" className="text-sm text-red-700">{sessionError}</p>}
              <div className="flex flex-wrap gap-3">
                <button type="button" disabled={isReplacingSession} onClick={() => { setPendingService(null); setSessionError(null); }} className="rounded-md border px-4 py-3 text-sm font-medium disabled:opacity-50">Keep saved form</button>
                <button type="button" disabled={isReplacingSession} onClick={() => void replaceSavedSession()} className="rounded-md bg-brand px-4 py-3 text-sm font-medium text-white disabled:opacity-50">{isReplacingSession ? "Starting..." : "Start new form"}</button>
              </div>
            </div>
          ) : (
            <>
              <ServiceTypeChoice onSelect={selectService} savedService={savedService} disabled={isRoutingSession || !!sessionError} />
              {isRoutingSession && <p role="status" className="mt-4 text-sm text-gray-600">Checking saved progress...</p>}
              {sessionError && <div className="mt-4 space-y-2"><p role="alert" className="text-sm text-red-700">{sessionError}</p><button type="button" onClick={() => void readSavedSession()} className="text-sm font-medium text-brand underline">Try again</button></div>}
            </>
          )}
        </ModalLayout>
      )}

      {/* Vacation-rental wizard — unchanged behaviour, unchanged numbering. */}
      {isModalOpen &&
        !showResumeVerification &&
        serviceType === "vacation_rental_subscription" && (
          <SignupForm
            isOpen={true}
            onClose={handleClose}
            initialData={resumeData || undefined}
            onChangeServiceType={
              serviceTypeChoiceEnabled ? handleChangeServiceType : undefined
            }
          />
        )}

      {/* Residential one-time wizard — item 4. */}
      {isModalOpen &&
        !showResumeVerification &&
        serviceType === "residential_one_time" && (
          <ResidentialForm
            isOpen={true}
            onClose={handleClose}
            onChangeServiceType={handleChangeServiceType}
            initialData={resumeData ? { formData: normalizeResidentialFormData(resumeData.formData as Record<string, unknown>), currentStep: resumeData.currentStep } : undefined}
          />
        )}
    </>
  );
};
