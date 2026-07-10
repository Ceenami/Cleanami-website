import { StepsProps } from "@/lib/validations/bookng-modal";
import { FormField } from "./FormField";
import { StepFeedback } from "./StepFeedback";
import { ShieldCheck } from "lucide-react";

export const Step1CustomerInfo = ({
  formData,
  setFormData,
  errors,
}: StepsProps) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  return (
    <div className="space-y-6">
      <FormField
        label="Full Name"
        name="name"
        type="text"
        placeholder="Jane Doe"
        value={formData.name || ""}
        onChange={handleChange}
        error={!!errors.name}
      />
      <FormField
        label="Email Address"
        name="email"
        type="email"
        placeholder="you@example.com"
        value={formData.email || ""}
        onChange={handleChange}
        error={!!errors.email}
      />
      <FormField
        label="Confirm Email Address"
        name="emailConfirm"
        type="email"
        placeholder="you@example.com"
        value={formData.emailConfirm || ""}
        onChange={handleChange}
        error={!!errors.emailConfirm}
      />
      <FormField
        label="Phone Number"
        name="phoneNumber"
        type="tel"
        placeholder="(555) 123-4567"
        value={formData.phoneNumber || ""}
        onChange={handleChange}
        error={!!errors.phoneNumber}
      />

      {/* Reassurance text - per spec */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-teal-600 flex-shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="text-sm text-gray-700 font-medium">
              We respect your inbox.
            </p>
            <p className="text-sm text-gray-600">
              We will only use your email and phone number to help you set up your 
              cleaning service and coordinate your turnovers.
            </p>
            <p className="text-sm text-gray-600 font-medium">
              No spam. No sales harassment. No third-party marketing.
            </p>
          </div>
        </div>
      </div>

      {/* Why we ask - per spec */}
      <p className="text-xs text-gray-500">
        <span className="font-medium">Why we ask for this:</span> This lets us save 
        your progress and help you if you need it. After payment, we&apos;ll email you a
        link to access your customer portal.
      </p>

      <StepFeedback
        errors={errors}
        fields={["name", "email", "emailConfirm", "phoneNumber"]}
      />
    </div>
  );
};
