"use client";

import { RadioCard } from "./RadioCard";

/**
 * Counterproposal item 7's pets question, asked on both flows.
 *
 * The wording differs by service type and both strings are the client's own
 * "Does this property allow pets?" for a
 * vacation rental, "Are pets normally present in the home?" for a residence —
 * so the question is a prop rather than a fork of the component.
 *
 * The fee is $10 per clean, customer revenue only: it changes no hours, no team
 * size and no cleaner pay (item 9, and `PET_FEE` in `pricing.service.ts`).
 */
interface Props {
  question: string;
  value: boolean | undefined;
  onChange: (petsAllowed: boolean) => void;
  /** Namespaced so both wizards can render one without colliding radio groups. */
  idPrefix?: string;
}

export const PetsField = ({
  question,
  value,
  onChange,
  idPrefix = "pets",
}: Props) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-2">
      {question}
    </label>
    <div className="grid grid-cols-2 gap-4">
      <RadioCard
        id={`${idPrefix}-yes`}
        name={`${idPrefix}-allowed`}
        value="yes"
        checked={value === true}
        title="Yes"
        description="Adds $10 per clean, and the cleaner is told to expect pet hair."
        onChange={() => onChange(true)}
      />
      <RadioCard
        id={`${idPrefix}-no`}
        name={`${idPrefix}-allowed`}
        value="no"
        checked={value !== true}
        title="No"
        description="No pet fee."
        onChange={() => onChange(false)}
      />
    </div>
  </div>
);
