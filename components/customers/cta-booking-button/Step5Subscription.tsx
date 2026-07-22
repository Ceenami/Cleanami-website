import { StepsProps } from "@/lib/validations/bookng-modal";
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import { addDays, format } from 'date-fns';
import { CalendarIcon, Info, ShieldCheck } from 'lucide-react';
import { StepFeedback } from "./StepFeedback";
import { FounderCard } from "../../FounderCard";
import { SubscriptionCard } from "./SubscriptionCard";
import { SUBSCRIPTION_DISCOUNT_TIERS } from "@/lib/pricing/subscription-discount";

interface Step5Props extends StepsProps {
  /** Called when user books a call */
  onBookCall?: () => void;
  /** Called when user continues without booking */
  onContinueSetup?: () => void;
}

/** Mandatory 7-day setup buffer before the first clean (re-enforced server-side). */
export const FIRST_CLEAN_BUFFER_DAYS = 7;

/** 1 month minimum (first month), up to 6 months. */
const SUBSCRIPTION_LENGTH_OPTIONS = [1, 2, 3, 4, 5, 6] as const;

/** Shortest qualifying term first, so the copy reads as a ladder. */
const DISCOUNT_TIERS_ASCENDING = [...SUBSCRIPTION_DISCOUNT_TIERS].sort(
  (a, b) => a.minMonths - b.minMonths
);

export const Step5Subscription = ({ 
  formData, 
  setFormData, 
  errors,
  onBookCall,
  onContinueSetup,
}: Step5Props) => {
  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      setFormData(prev => ({ ...prev, firstCleanDate: date }));
    }
  };

  const handleMonthsSelect = (months: number) => {
    setFormData((prev) => ({ ...prev, subscriptionMonths: months }));
  };

  const hasSelectedDate = !!formData.firstCleanDate;
  const selectedMonths = formData.subscriptionMonths ?? 1;

  // First selectable day = today + 7-day buffer. Computed at render (no stale
  // hardcoded launch date); the same rule is re-enforced server-side.
  const firstAvailableDay = addDays(new Date(), FIRST_CLEAN_BUFFER_DAYS);

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-medium text-gray-900">Subscription Length</h3>
        <p className="mt-2 text-sm text-gray-600">
          Choose how long you&apos;d like to subscribe for. One month is the
          minimum, and longer terms cost less per clean.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {SUBSCRIPTION_LENGTH_OPTIONS.map((months) => (
            <SubscriptionCard
              key={months}
              months={months}
              selected={selectedMonths === months}
              onSelect={handleMonthsSelect}
            />
          ))}
        </div>
        <p className="mt-3 text-sm text-gray-600">
          {DISCOUNT_TIERS_ASCENDING.map((tier, index) => (
            <span key={tier.minMonths}>
              {index > 0 && " "}
              Subscribe for{" "}
              <span className="font-medium">
                {tier.minMonths} months{index === 0 ? " or more" : ""}
              </span>{" "}
              and save{" "}
              <span className="font-medium">
                {Math.round(tier.rate * 100)}%
              </span>{" "}
              on every clean.
            </span>
          ))}
        </p>

        {/* Commitment + cancellation transparency, per the functionality spec:
            customers must be told before signing up that a term can be
            cancelled at renewal but not mid-term, and that cleans inside an
            active term are not skippable or refundable without admin approval. */}
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="flex items-start gap-3">
            <Info className="mt-0.5 h-5 w-5 flex-shrink-0 text-gray-500" />
            <div>
              <p className="text-sm font-medium text-gray-800">
                What your {selectedMonths}-month subscription means
              </p>
              <ul className="mt-2 space-y-1.5 text-sm text-gray-600">
                <li>
                  You pay for your first clean today. Every clean after that is
                  charged individually, as each turnover happens.
                </li>
                <li>
                  You can cancel when your term comes up for renewal. A
                  subscription can&apos;t be cancelled part-way through its term.
                </li>
                <li>
                  Cleans booked inside an active term can&apos;t be skipped or
                  refunded unless we approve it — if your plans change, just get
                  in touch and we&apos;ll help.
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-medium text-gray-900">Select First Clean Date</h3>
        
        {/* Reassurance text ABOVE date selector - per spec */}
        <div className="mt-3 bg-teal-50 border border-teal-200 rounded-lg p-4 flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-teal-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-teal-800 font-medium">
              To guarantee cleaner availability, we require a short setup window before your first clean.
            </p>
            <p className="text-sm text-teal-700 mt-1">
              This ensures your property is fully staffed and protected.
            </p>
          </div>
        </div>

        <p className="mt-4 text-sm text-gray-600">
          To ensure cleaner availability, there is a mandatory {FIRST_CLEAN_BUFFER_DAYS}-day buffer before your first turnover can be scheduled. Our first available date is {format(firstAvailableDay, 'PPP')}. We&apos;ll contact you with a welcome call.
        </p>
        
        <div className="mt-4 flex flex-col gap-8 items-start">
          <DayPicker
            mode="single"
            selected={formData.firstCleanDate}
            onSelect={handleDateSelect}
            disabled={{ before: firstAvailableDay }}
            className="border rounded-md p-2 text-gray-800"
            styles={{
              head_cell: { width: '40px' },
              day: { width: '40px', height: '40px' },
            }}
          />
          <div className="flex-1">
            <h4 className="font-semibold text-gray-700">Selected Date:</h4>
            {formData.firstCleanDate ? (
              <div className="mt-2 flex items-center p-3 border border-gray-200 rounded-md bg-gray-50">
                <CalendarIcon className="h-5 w-5 text-teal-600 mr-3"/>
                <span className="font-medium text-gray-800">{format(formData.firstCleanDate, 'PPPP')}</span>
              </div>
            ) : (
              <p className="mt-2 text-sm text-gray-500">Please select a date from the calendar.</p>
            )}
          </div>
        </div>
      </div>

      <StepFeedback 
        errors={errors}
        fields={['subscriptionMonths', 'firstCleanDate']}
      />

      {/* Founder Card - CALL DECISION POINT D (after date selection) */}
      {hasSelectedDate && onBookCall && onContinueSetup && (
        <FounderCard
          onBookCall={onBookCall}
          onContinue={onContinueSetup}
        />
      )}
    </div>
  );
};