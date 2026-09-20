"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { SignupForm } from "./SignupForm";
import { ResidentialForm } from "./residential/ResidentialForm";
import { ServiceTypeChoice } from "./ServiceTypeChoice";
import { ModalLayout } from "./ModalLayout";
import { loadSession, clearSession, createSession } from "@/lib/actions/session.actions";
import { SignupFormData, PriceDetails } from "@/lib/validations/bookng-modal";
import { ResumeVerification } from "@/components/ResumeVerification";
import { readSessionServiceType } from "@/lib/validations/booking-session";
import { isServiceTypeChoiceEnabled } from "@/lib/config/booking-flags";
import type { ServiceType } from "@/lib/constants/service-type";

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

  /**
   * Which wizard is on screen. `null` means the service-type question is (item
   * 2). When `NEXT_PUBLIC_SERVICE_TYPE_CHOICE` is off this is seeded to the
   * vacation-rental value and never becomes null, so the modal opens directly
   * on today's step 1 and the product is exactly what it is now
   * (`DELIVERY.md`'s rollback lever).
   */
  const serviceTypeChoiceEnabled = isServiceTypeChoiceEnabled();
  const [serviceType, setServiceType] = useState<ServiceType | null>(
    serviceTypeChoiceEnabled ? null : "vacation_rental_subscription"
  );
  /** True while we are asking the saved session which wizard it belongs to. */
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
    setShowResumeVerification(false);
  }, []);

  // Handle cancel - start fresh
  const handleVerificationCancel = useCallback(async () => {
    await clearSession();
    await createSession();
    setShowResumeVerification(false);
    setResumeSessionId(null);
    setResumeData(null);
    // Modal stays open, user starts fresh
  }, []);

  // Handle modal close
  const handleClose = useCallback(() => {
    setIsModalOpen(false);
    setShowResumeVerification(false);
    setResumeSessionId(null);
    // Don't clear resumeData - keep it if they reopen
  }, []);

  /**
   * A customer who was mid-booking when this shipped must not be asked a
   * question they have never seen and then dropped back at step 1. So the saved
   * session is consulted first:
   *
   *   marked residential  → the residential wizard
   *   marked vacation     → the vacation-rental wizard
   *   saved but UNMARKED  → the vacation-rental wizard, because that is the
   *                         only thing it could have been
   *   no session          → ask the question
   */
  const routeFromSession = useCallback(async () => {
    setIsRoutingSession(true);
    try {
      const result = await loadSession();
      if (result.success) {
        setServiceType(
          readSessionServiceType(
            result.formData as Record<string, unknown>
          ) ?? "vacation_rental_subscription"
        );
      }
    } catch {
      // A failed peek just means the question gets asked. Harmless.
    } finally {
      setIsRoutingSession(false);
    }
  }, []);

  // Handle modal open (from button click)
  const handleOpen = useCallback(() => {
    if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
    window.gtag('event', 'conversion', {
      send_to: 'AW-17499794760/NY5gCKPU594bEMjaxphB',
    });
  }
    setIsModalOpen(true);
    if (serviceTypeChoiceEnabled && serviceType === null) {
      void routeFromSession();
    }
  }, [serviceTypeChoiceEnabled, serviceType, routeFromSession]);

  /** Back to the question, discarding the in-progress session. */
  const handleChangeServiceType = useCallback(async () => {
    await clearSession();
    await createSession();
    setResumeData(null);
    setServiceType(null);
  }, []);

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
          showPriceSummary={false}
          priceDetails={null}
        >
          {isRoutingSession ? (
            <div className="py-12 text-center text-gray-600">Loading...</div>
          ) : (
            <ServiceTypeChoice onSelect={setServiceType} />
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
          />
        )}
    </>
  );
};
