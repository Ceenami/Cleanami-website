import React from "react";
import { FeatureCard } from "./FeatureCard";
import { CalendarDaysIcon, DollarSign, SparklesIcon, ShieldCheckIcon } from "lucide-react";

export const Features = () => {
  return (
    <section className="py-20">
      <div className="container mx-auto px-4">
        <div className="text-center mb-12">
          <h2 className="text-4xl md:text-6xl text-brand/80 font-bold">
            The CleanNami Difference
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          <FeatureCard
            icon={<CalendarDaysIcon className="h-8 w-8 text-white" />}
            title="Seamless Booking & Automation"
            description="Set up your property preferences once, and CleanNami takes care
                of the rest. Rental turnovers schedule themselves off your
                calendar; one-time home cleans book in a couple of minutes."
          />
          <FeatureCard
            icon={<DollarSign className="h-8 w-8 text-white"/>}
            title="Consistent & Transparent Pricing"
            description="No haggling, no hidden fees. You see the exact price upfront —
                based on your property's size and the options you choose — and
                it stays the same every clean."
          />
          <FeatureCard
            icon={<SparklesIcon className="h-8 w-8 text-white"/>}
            title="More Than Just Cleaning"
            description="Rentals get the full turnover — beds staged, essentials
                restocked, hot tubs reset, ready for the next check-in. Homes get
                a thorough top-to-bottom clean to the same standard."
          />
          <FeatureCard
            icon={<ShieldCheckIcon className="h-8 w-8 text-white"/>}
            title="Reliability You Can Trust"
            description="Cleaners are GPS-verified at check-in and check-out. With
                performance tracking and a dedicated on-call backup pool, your
                clean gets done on time, every time."
          />
        </div>
      </div>
    </section>
  );
};
