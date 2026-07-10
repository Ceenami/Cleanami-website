import { SignupFormData } from "./index";

/** JSON-safe booking form payload for API routes and server actions. */
export type SerializableSignupFormData = Omit<
  SignupFormData,
  "checklistFile" | "firstCleanDate"
> & {
  firstCleanDate?: string;
};

export function serializeSignupFormDataForServer(
  formData: SignupFormData
): SerializableSignupFormData {
  const { checklistFile, firstCleanDate, ...rest } = formData;
  void checklistFile;

  return {
    ...rest,
    firstCleanDate:
      firstCleanDate instanceof Date
        ? firstCleanDate.toISOString()
        : typeof firstCleanDate === "string"
          ? firstCleanDate
          : undefined,
  };
}

export function deserializeSignupFormDataFromServer(
  data: SerializableSignupFormData
): SignupFormData {
  const { firstCleanDate, ...rest } = data;

  return normalizeSignupFormDataForPricing({
    ...rest,
    firstCleanDate: firstCleanDate ? new Date(firstCleanDate) : undefined,
    checklistFile: undefined,
  });
}

/** Coerce JSON/session values so server pricing matches the booking form. */
export function normalizeSignupFormDataForPricing(
  data: SignupFormData
): SignupFormData {
  return {
    ...data,
    bedrooms: Number(data.bedrooms) || 0,
    bathrooms: Number(data.bathrooms) || 0,
    sqft: Number(data.sqft) || 0,
    laundryLoads: Number(data.laundryLoads) || 0,
    subscriptionMonths: Number(data.subscriptionMonths) || 1,
    hasHotTub: Boolean(data.hasHotTub),
    hotTubService: Boolean(data.hotTubService),
    hotTubDrain: Boolean(data.hotTubDrain),
  };
}
