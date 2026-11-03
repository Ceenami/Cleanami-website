interface ProgressBarProps {
  currentStep: number;
  totalSteps: number;
  stepLabels?: readonly string[];
}

export const ProgressBar = ({ currentStep, totalSteps, stepLabels }: ProgressBarProps) => {
  const percentage = ((currentStep - 1) / (totalSteps - 1)) * 100;

  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-600">Step {currentStep} of {totalSteps}{stepLabels?.[currentStep - 1] ? `: ${stepLabels[currentStep - 1]}` : ""}</p>
      <div
        role="progressbar"
        aria-label="Booking progress"
        aria-valuemin={1}
        aria-valuemax={totalSteps}
        aria-valuenow={currentStep}
        aria-valuetext={`Step ${currentStep} of ${totalSteps}`}
        className="w-full bg-gray-200 rounded-full h-2"
      >
        <div
          className="bg-brand h-2 rounded-full transition-all duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${percentage}%` }}
        />
      </div>
      {stepLabels?.[currentStep] && <p className="text-xs text-gray-500">Next: {stepLabels[currentStep]}</p>}
    </div>
  );
};
