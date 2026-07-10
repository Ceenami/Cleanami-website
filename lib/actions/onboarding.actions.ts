"use server";

import { SignupFormData } from "../validations/bookng-modal";
import { completeOnboardingForPayment } from "@/lib/services/complete-onboarding.service";
import {
  deserializeSignupFormDataFromServer,
  SerializableSignupFormData,
  serializeSignupFormDataForServer,
} from "../validations/bookng-modal/serialize-signup-form";

export async function completeOnboarding(
  formData: SignupFormData | SerializableSignupFormData,
  paymentIntentId: string
) {
  const normalized =
    "checklistFile" in formData && formData.checklistFile !== undefined
      ? deserializeSignupFormDataFromServer(
          serializeSignupFormDataForServer(formData as SignupFormData)
        )
      : deserializeSignupFormDataFromServer(
          formData as SerializableSignupFormData
        );

  if ("checklistFile" in formData && formData.checklistFile) {
    normalized.checklistFile = formData.checklistFile as File[];
  }

  return completeOnboardingForPayment(normalized, paymentIntentId);
}
