"use client";

import React, { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { PriceSummary } from "./PriceSummary";
import { PriceDetails } from "@/lib/validations/bookng-modal";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title: string;
  showPriceSummary: boolean;
  priceDetails: PriceDetails | null;
  isPriceRecalculating?: boolean;
  /** Passed straight through to `PriceSummary`; see its props for why. */
  priceSummaryTitle?: string;
  priceSummaryCustomQuoteMessage?: string;
  priceSummaryTotalLabel?: string;
}

export const ModalLayout = ({
  isOpen,
  onClose,
  children,
  title,
  showPriceSummary,
  priceDetails,
  isPriceRecalculating = false,
  priceSummaryTitle,
  priceSummaryCustomQuoteMessage,
  priceSummaryTotalLabel,
}: Props) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable?.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-gray-950/70 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex max-h-[calc(100dvh-0.5rem)] w-full max-w-4xl flex-col rounded-t-2xl bg-white shadow-xl outline-none sm:max-h-[90dvh] sm:rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b bg-white px-5 py-4 sm:p-5">
          <h2 id={titleId} className="text-xl font-semibold text-gray-800">{title}</h2>
          <button
            onClick={onClose}
            className="inline-flex h-11 w-11 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
            aria-label="Close booking form"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
        <div className="min-h-0 flex-grow overflow-y-auto overscroll-contain">
          <div
            className={`grid ${
              showPriceSummary ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"
            } gap-0 md:gap-8`}
          >
            <div className="p-5 sm:p-6 md:p-8">{children}</div>
            {showPriceSummary && (
              <div className="hidden border-l border-gray-100 bg-white p-6 md:block md:p-8">
                <PriceSummary
                  priceDetails={priceDetails}
                  isRecalculating={isPriceRecalculating}
                  title={priceSummaryTitle}
                  customQuoteMessage={priceSummaryCustomQuoteMessage}
                  totalLabel={priceSummaryTotalLabel}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
