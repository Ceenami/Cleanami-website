"use client";

import Image from "next/image";
import { Calendar, ArrowRight } from "lucide-react";

interface FounderCardProps {
  onBookCall: () => void;
  onContinue: () => void;
  introText?: string;
  showMicrotext?: boolean;
  isLoading?: boolean;
}

const FOUNDER_IMAGE_PATH = "/images/ceenami-headshot.jpg"; 
const GOOGLE_CALENDAR_BOOKING_URL = "https://calendar.app.google/sFQGHgmBo2Jq6pww9";

export function FounderCard({
  onBookCall,
  onContinue,
  introText,
  showMicrotext = true,
  isLoading = false,
}: FounderCardProps) {
  const handleBookCall = () => {
    if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
    window.gtag('event', 'conversion', {
      send_to: 'AW-17499794760/nbASCOrI5N4bEMjaxphB',
    });
  }
    // Open Google Calendar booking in new tab
    window.open(GOOGLE_CALENDAR_BOOKING_URL, "_blank", "noopener,noreferrer");
    // Trigger the callback (saves session, etc.)
    onBookCall();
  };

  return (
    <div className="space-y-4">
      {/* Intro text above card */}
      {introText && (
        <p className="text-gray-700 text-sm">{introText}</p>
      )}

      {/* Card */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-5">
        {/* Founder info row */}
        <div className="flex items-start gap-4 mb-5">
          {/* Circular headshot */}
          <div className="relative w-16 h-16 flex-shrink-0">
            <Image
              src={FOUNDER_IMAGE_PATH}
              alt="Ceenami - Founder of CleanNami"
              fill
              className="rounded-full object-cover"
            />
          </div>

          {/* Name and title */}
          <div>
            <h4 className="font-semibold text-gray-900">Ceenami</h4>
            <p className="text-sm text-gray-600">Founder, CleanNami</p>
            <p className="text-sm text-gray-500 mt-1">
              Vacation rental owner. Built CleanNami to solve this exact problem.
            </p>
          </div>
        </div>

        {/* Buttons */}
        <div className="space-y-3">
          <button
            onClick={handleBookCall}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-brand text-white font-medium rounded-lg hover:bg-brand/80 transition-colors disabled:opacity-50"
          >
            <Calendar className="w-4 h-4" />
            Book a 5-Minute Setup Call
          </button>

          <button
            onClick={onContinue}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-white text-gray-700 font-medium rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Continue setup on your own
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {/* Microtext */}
        {showMicrotext && (
          <p className="text-xs text-gray-500 text-center mt-4">
            No sales pressure. I&apos;ll help you set this up correctly.
          </p>
        )}
      </div>
    </div>
  );
}

export { FOUNDER_IMAGE_PATH, GOOGLE_CALENDAR_BOOKING_URL };