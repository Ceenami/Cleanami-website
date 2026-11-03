"use client";

import type { ResidentialCleaningLevel } from "@/lib/pricing/residential";
import { RESIDENTIAL_LEVEL_DESCRIPTIONS } from "@/lib/constants/service-type";
import { RadioCard } from "../RadioCard";

export function ResidentialLevelChoice({
  value,
  onChange,
  disabled = false,
  pricingVersion,
}: {
  value?: ResidentialCleaningLevel;
  onChange: (level: ResidentialCleaningLevel) => void;
  disabled?: boolean;
  pricingVersion?: "residential-v1" | "residential-v2";
}) {
  return (
    <fieldset disabled={disabled} className="space-y-3">
      <legend className="text-sm font-medium text-gray-700 mb-2">
        Choose your clean
      </legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(["standard", "deep"] as const).map((level) => (
          <RadioCard
            key={level}
            id={`residential-level-${level}`}
            name="cleaningLevel"
            value={level}
            checked={value === level}
            title={level === "standard" ? "Standard Clean" : "Deep Clean"}
            description={
              RESIDENTIAL_LEVEL_DESCRIPTIONS[level] +
              (pricingVersion === "residential-v2" && level === "deep"
                ? " Interior oven and refrigerator cleaning is included."
                : "")
            }
            onChange={() => onChange(level)}
          />
        ))}
      </div>
    </fieldset>
  );
}
