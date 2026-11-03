"use client";

import { CalendarClock, Home } from "lucide-react";
import {
  SERVICE_TYPE_LABELS,
  type ServiceType,
} from "@/lib/constants/service-type";

/**
 * *"What type of cleaning do you need?"*, the first
 * thing the booking modal shows.
 *
 * **It is not a renumbered step 0, and that is deliberate.** Inserting a step
 * before step 1 would shift every index in `SignupForm` — `stepFields`,
 * `stepTitles`, the `currentStep < 7` footer test, `TOTAL_STEPS`, and the
 * `current_step` already persisted in `onboarding_sessions` for customers who
 * are mid-funnel right now. Those customers would resume one step off. Asking
 * the question *in front of* both wizards leaves the vacation-rental step
 * numbering byte-identical and makes the mis-resume impossible rather than
 * merely handled.
 *
 * Saved progress never hides either choice. The entry point confirms a reset
 * before replacing an existing form with the other service's fields.
 */
interface Props {
  onSelect: (serviceType: ServiceType) => void;
  savedService?: ServiceType | null;
  disabled?: boolean;
}

const CHOICES: Array<{
  value: ServiceType;
  icon: typeof Home;
  blurb: string;
  bullets: string[];
}> = [
  {
    value: "vacation_rental_subscription",
    icon: CalendarClock,
    blurb:
      "Recurring turnovers for a short-term rental, scheduled from your booking calendar.",
    bullets: [
      "Syncs with your Airbnb or VRBO calendar",
      "Laundry and hot tub care available",
      "Discounts on 3 and 6 month terms",
    ],
  },
  {
    value: "residential_one_time",
    icon: Home,
    blurb: "A one-time clean of your home, on a date you choose.",
    bullets: [
      "Choose Standard Clean or Deep Clean",
      "One clean, one price, paid up front",
      "Pick your arrival window",
      "At least 48 hours' notice",
    ],
  },
];

export const ServiceTypeChoice = ({ onSelect, savedService, disabled = false }: Props) => (
  <div className="space-y-6">
    <div>
      <h3 className="text-lg font-medium text-gray-900">
        What type of cleaning do you need?
      </h3>
      <p className="mt-1 text-sm text-gray-600">
        Choose your service to see the right booking steps.
      </p>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {CHOICES.map((choice) => {
        const Icon = choice.icon;
        return (
          <button
            key={choice.value}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(choice.value)}
            className="text-left p-5 border border-gray-300 rounded-lg transition-colors duration-200 hover:border-teal-500 hover:bg-teal-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none"
          >
            <Icon className="h-7 w-7 text-teal-600" />
            <h4 className="mt-3 font-semibold text-gray-900">
              {SERVICE_TYPE_LABELS[choice.value]}
            </h4>
            <p className="mt-1 text-sm text-gray-600">{choice.blurb}</p>
            {savedService === choice.value && <p className="mt-2 text-sm font-medium text-teal-700">Saved booking available</p>}
            <ul className="mt-3 space-y-1">
              {choice.bullets.map((bullet) => (
                <li key={bullet} className="text-xs text-gray-500">
                  • {bullet}
                </li>
              ))}
            </ul>
          </button>
        );
      })}
    </div>

    <p className="text-xs text-gray-500">
      {savedService
        ? "Select your saved service to continue, or choose the other service to start a new form."
        : "You can go back to change your service before payment."}
    </p>
  </div>
);
