import { useEffect, useState } from "react";
import type { StepsProps } from "@/lib/validations/bookng-modal";
import { FounderCard } from "../../FounderCard";
interface Step3Props extends StepsProps {
  onBookCall?: () => void;
  onContinueSetup?: () => void;
}
export function Step3Checklist({
  setFormData,
  onBookCall,
  onContinueSetup,
}: Step3Props) {
  const [choice, setChoice] = useState<"basic" | "later">("basic");
  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      useDefaultChecklist: true,
      checklistFile: [],
      checklistSheetUrl: "",
    }));
  }, [setFormData]);
  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold">Your turnover checklist</h2>
        <p className="mt-2 text-sm text-gray-600">
          Start with CleanNami’s Basic Turnover Checklist. No document upload is
          required.
        </p>
      </header>
      <fieldset className="space-y-4">
        <legend className="sr-only">Checklist setup</legend>
        <label className="flex gap-3 border-b pb-4">
          <input
            type="radio"
            name="rental-checklist"
            checked={choice === "basic"}
            onChange={() => setChoice("basic")}
          />
          <span>
            <span className="font-medium">Basic Turnover Checklist</span>
            <span className="block text-sm text-gray-600 mt-1">
              Company essentials and tasks appropriate to your property’s
              services.
            </span>
          </span>
        </label>
        <label className="flex gap-3">
          <input
            type="radio"
            name="rental-checklist"
            checked={choice === "later"}
            onChange={() => setChoice("later")}
          />
          <span>
            <span className="font-medium">Customize after signup</span>
            <span className="block text-sm text-gray-600 mt-1">
              Basic stays active while you prepare your property-specific tasks.
            </span>
          </span>
        </label>
      </fieldset>
      <p className="text-sm bg-teal-50 p-4 rounded">
        After signup, open Customer Portal → Property → Checklist. Select
        library tasks or add custom tasks for admin review. Changes apply to
        newly issued jobs, not existing cleans.
      </p>
      <FounderCard
        onBookCall={onBookCall ?? (() => {})}
        onContinue={onContinueSetup ?? (() => {})}
      />
    </div>
  );
}
