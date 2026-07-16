import { StepsProps } from "@/lib/validations/bookng-modal";
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import { addDays, format } from 'date-fns';
import { CalendarIcon, ShieldCheck } from 'lucide-react';
import { StepFeedback } from "./StepFeedback";
import { FounderCard } from "../../FounderCard";
import { SubscriptionCard } from "./SubscriptionCard";

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
          Choose how long you want to subscribe. The first month is the minimum.
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
        <p className="mt-3 text-sm text-gray-500">
          You pay for your first clean now. Later cleans are charged as they happen
          during your {selectedMonths}-month term.
        </p>
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