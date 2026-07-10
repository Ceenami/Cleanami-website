"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { SignupForm } from "./SignupForm";
import { ModalLayout } from "./ModalLayout";
import { loadSession, clearSession, createSession } from "@/lib/actions/session.actions";
import { SignupFormData, PriceDetails } from "@/lib/validations/bookng-modal";
import { ResumeVerification } from "@/components/ResumeVerification";

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

  // Handle modal open (from button click)
  const handleOpen = useCallback(() => {
    if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
    window.gtag('event', 'conversion', {
      send_to: 'AW-17499794760/NY5gCKPU594bEMjaxphB',
    });
  }
    setIsModalOpen(true);
  }, []);

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

      {/* Main Signup Form */}
      {isModalOpen && !showResumeVerification && (
        <SignupForm
          isOpen={true}
          onClose={handleClose}
          initialData={resumeData || undefined}
        />
      )}
    </>
  );
};