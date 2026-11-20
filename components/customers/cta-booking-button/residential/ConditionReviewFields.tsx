"use client";
import { CONDITION_REVIEW_LABEL } from "@/lib/booking/condition-review";

export function ConditionReviewFields({ selected, description, onChange, error, disabled }: {
  selected?: boolean; description?: string; disabled?: boolean; error?: string;
  onChange: (patch: { unusualConditions: boolean; conditionDescription?: string }) => void;
}) {
  return <fieldset className="space-y-3" disabled={disabled}>
    <label className="flex items-start gap-2 text-sm font-medium text-gray-800">
      <input type="checkbox" checked={selected ?? false} onChange={e => onChange({ unusualConditions: e.target.checked, conditionDescription: e.target.checked ? description : undefined })} />
      {CONDITION_REVIEW_LABEL}
    </label>
    {selected && <div>
      <label htmlFor="conditionDescription" className="block text-sm font-medium text-gray-700">Describe the property’s condition (required)</label>
      <textarea id="conditionDescription" required maxLength={2000} rows={4} value={description ?? ""}
        aria-invalid={!!error} aria-describedby="condition-description-help"
        onChange={e => onChange({ unusualConditions: true, conditionDescription: e.target.value })}
        className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-800" />
      <p id="condition-description-help" className="mt-1 text-sm text-gray-600">Book and pay as usual. Management will review the condition. If we cannot perform the clean, we will explain why and refund your payment in full. Please keep entry codes in the access fields.</p>
      {error && <p role="alert" className="mt-1 text-sm text-red-700">{error}</p>}
    </div>}
  </fieldset>;
}
