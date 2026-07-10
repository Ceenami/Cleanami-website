'use server';

import { SignupFormData } from '../validations/bookng-modal';
import { createPaymentIntentForSignup } from '@/lib/services/create-payment-intent.service';
import {
  deserializeSignupFormDataFromServer,
  SerializableSignupFormData,
  serializeSignupFormDataForServer,
} from '../validations/bookng-modal/serialize-signup-form';

export async function createValidatedPaymentIntent(
  formData: SignupFormData | SerializableSignupFormData
): Promise<{ clientSecret?: string | null; error?: string }> {
  try {
    const normalized =
      "checklistFile" in formData && formData.checklistFile !== undefined
        ? deserializeSignupFormDataFromServer(
            serializeSignupFormDataForServer(formData as SignupFormData)
          )
        : deserializeSignupFormDataFromServer(
            formData as SerializableSignupFormData
          );

    const result = await createPaymentIntentForSignup(normalized);
    return {
      clientSecret: result.clientSecret ?? null,
      error: result.error,
    };
  } catch (error) {
    console.error("Error creating Payment Intent:", error);
    return { error: 'Could not initialize payment. Please contact support.' };
  }
}
