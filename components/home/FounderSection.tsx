"use client";

import Image from "next/image";
import { SignupModal } from "../customers/cta-booking-button";
import { Calendar } from "lucide-react";
import { Suspense } from "react";

const FOUNDER_IMAGE_PATH = "/images/ceenami-headshot.jpg";
const GOOGLE_CALENDAR_BOOKING_URL =
  "https://calendar.app.google/g2vMVoyihnQK2nPy9";

export const FounderSection = () => {
  const handleBookCall = () => {
    if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
    window.gtag('event', 'conversion', {
      send_to: 'AW-17499794760/nbASCOrI5N4bEMjaxphB',
    });
  }
  
    window.open(GOOGLE_CALENDAR_BOOKING_URL, "_blank", "noopener,noreferrer");
  };

  return (
    <section className="py-16 bg-white">
      <div className="container mx-auto px-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-col md:flex-row items-center gap-8 md:gap-12">
            {/* Large founder photo */}
            <div className="flex-shrink-0">
              <div className="relative w-48 h-48 md:w-64 md:h-64">
                <Image
                  src={FOUNDER_IMAGE_PATH}
                  alt="Ceenami - Founder of CleanNami"
                  fill
                  className="rounded-2xl object-cover shadow-lg"
                />
              </div>
            </div>

            {/* Content */}
            <div className="text-center md:text-left">
              <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-4">
                Built by a Host, for Hosts
              </h2>

              {/* Exact copy from spec */}
              <div className="space-y-3 text-gray-600 mb-6">
                <p className="text-lg">
                  Hey — I&apos;m Ceenami. I&apos;m a vacation rental owner here in Volusia County.
                </p>
                <p className="text-lg">
                  After dealing with missed cleans and last-minute stress, I built CleanNami to make sure turnovers are handled consistently and without surprises. It&apos;s what I use on my own property today.
                </p>
                <p className="text-lg font-medium text-gray-800">
                  I&apos;m opening it up to local hosts who want a reliable, ongoing turnover system — where every checkout is covered automatically, without constant follow-ups or last-minute issues.
                </p>
              </div>

              <p className="text-sm text-gray-500 mb-6">— Ceenami, Founder</p>

              {/* Two CTAs per spec */}
              <div className="flex flex-col sm:flex-row gap-4 justify-center md:justify-start">
                <Suspense
                  fallback={
                    <button className="px-6 py-3 bg-brand text-white font-semibold rounded-lg shadow-md">
                      Get Your Price Now!
                    </button>
                  }
                >
                  <SignupModal />
                </Suspense>
                <button
                  onClick={handleBookCall}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-white text-brand font-semibold rounded-lg shadow-md border-2 border-brand hover:bg-brand/5 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:ring-opacity-75 transition-all"
                >
                  <Calendar className="w-5 h-5" />
                  Book a 5-Minute Setup Call
                </button>
              </div>
            </div>
          </div>

          {/* Trust line per spec */}
          <div className="mt-12 pt-8 border-t border-gray-200">
            <div className="flex flex-wrap justify-center gap-x-8 gap-y-2 text-sm text-gray-600">
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 bg-teal-500 rounded-full"></span>
                Transparent pricing
              </span>
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 bg-teal-500 rounded-full"></span>
                30-day minimum coverage
              </span>
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 bg-teal-500 rounded-full"></span>
                No spam
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
