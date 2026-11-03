"use client";

import type { ResidentialFormData } from "@/lib/validations/residential";
import { StepFeedback } from "../StepFeedback";

interface Props {
  formData: ResidentialFormData;
  setFormData: React.Dispatch<React.SetStateAction<ResidentialFormData>>;
  errors: Record<string, string[] | undefined>;
}

const inputClass =
  "block min-h-11 w-full px-3 py-2 border text-gray-800 rounded-md shadow-sm placeholder-gray-400 focus:outline-none sm:text-sm focus:ring-brand focus:border-brand";

/**
 * R1 — your details. The same four fields the vacation-rental wizard's step 1
 * collects, and no more: item 4's residential list starts here.
 *
 * `FormField` is not reused because its `name` is typed `keyof SignupFormData`,
 * and widening that type to `string` would remove a real check from the
 * vacation-rental form to save four lines here.
 */
export const R1YourDetails = ({
  formData,
  setFormData,
  errors,
}: Props) => {
  const set = (patch: ResidentialFormData) =>
    setFormData((prev) => ({ ...prev, ...patch }));

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900">Your details</h3>
        <p className="mt-1 text-sm text-gray-600">
          So we can confirm your clean and reach you if anything changes.
        </p>
      </div>

      <div>
        <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
          Full name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          aria-invalid={!!errors.name}
          placeholder="Jane Doe"
          value={formData.name ?? ""}
          onChange={(e) => set({ name: e.target.value })}
          className={`${inputClass} ${errors.name ? "border-red-500" : "border-gray-300"}`}
          required
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            aria-invalid={!!errors.email}
            placeholder="jane@example.com"
            value={formData.email ?? ""}
            onChange={(e) => set({ email: e.target.value })}
            className={`${inputClass} ${errors.email ? "border-red-500" : "border-gray-300"}`}
            required
          />
        </div>
        <div>
          <label
            htmlFor="emailConfirm"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Confirm email
          </label>
          <input
            id="emailConfirm"
            name="emailConfirm"
            type="email"
            autoComplete="off"
            aria-invalid={!!errors.emailConfirm}
            placeholder="jane@example.com"
            value={formData.emailConfirm ?? ""}
            onChange={(e) => set({ emailConfirm: e.target.value })}
            className={`${inputClass} ${
              errors.emailConfirm ? "border-red-500" : "border-gray-300"
            }`}
            required
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="phoneNumber"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Phone number
        </label>
        <input
          id="phoneNumber"
          name="phoneNumber"
          type="tel"
          autoComplete="tel"
          aria-invalid={!!errors.phoneNumber}
          placeholder="(386) 555-0142"
          value={formData.phoneNumber ?? ""}
          onChange={(e) => set({ phoneNumber: e.target.value })}
          className={`${inputClass} ${
            errors.phoneNumber ? "border-red-500" : "border-gray-300"
          }`}
          required
        />
      </div>

      <StepFeedback
        errors={errors}
        fields={["name", "email", "emailConfirm", "phoneNumber"]}
        message="Fields are required to proceed."
      />

    </div>
  );
};
