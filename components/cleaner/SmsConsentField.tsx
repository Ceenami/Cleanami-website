"use client";

import { useId } from "react";
import Link from "next/link";
import { SMS_CONSENT_TEXT, SMS_CONSENT_DETAILS, SMS_TERMS_PATH, PRIVACY_POLICY_PATH } from "@/lib/sms/consent";

export function SmsConsentField({ checked, onChange, disabled = false }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="space-y-2 text-sm text-gray-700">
      <label htmlFor={id} className="flex cursor-pointer items-start gap-3 py-2">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          disabled={disabled}
          aria-describedby={`${id}-details ${id}-links`}
          className="mt-1 h-5 w-5 shrink-0 accent-brand"
        />
        <span>{SMS_CONSENT_TEXT}</span>
      </label>
      <p id={`${id}-details`}>{SMS_CONSENT_DETAILS}</p>
      <p id={`${id}-links`}>
        See our{" "}
        <Link href={SMS_TERMS_PATH} target="_blank" rel="noopener noreferrer" className="text-brand underline underline-offset-4">SMS Terms</Link>
        {" "}and{" "}
        <Link href={PRIVACY_POLICY_PATH} target="_blank" rel="noopener noreferrer" className="text-brand underline underline-offset-4">Privacy Policy</Link>.
      </p>
    </div>
  );
}
