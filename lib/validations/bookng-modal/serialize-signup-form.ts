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

/**
 * Coerce JSON/session values so server pricing matches the booking form.
 *
 * `laundryLoads` is deliberately NOT floored to 0: `signupFormSchema` declares
 * it `.min(1).optional()`, so an invented 0 is a *validation failure* while an
 * absent value is legal. Because `complete-onboarding.service.ts` re-parses
 * this payload with that schema AFTER the card has been confirmed, coercing to
 * 0 turned "customer cleared the loads box" (`Step4Addons` renders
 * `value={formData.laundryLoads || ""}`, so an empty box round-trips as
 * undefined) into a 400 on an already-charged booking. Keep only a valid
 * positive load count; anything else stays undefined. Pricing already treats
 * undefined as zero loads (`pricing.service.ts` `_calculateLaundryCost`).
 */
export function normalizeSignupFormDataForPricing(
  data: SignupFormData
): SignupFormData {
  const laundryLoads = Number(data.laundryLoads);

  return {
    ...data,
    bedrooms: Number(data.bedrooms) || 0,
    bathrooms: Number(data.bathrooms) || 0,
    sqft: Number(data.sqft) || 0,
    laundryLoads:
      Number.isInteger(laundryLoads) && laundryLoads >= 1
        ? laundryLoads
        : undefined,
    subscriptionMonths: Number(data.subscriptionMonths) || 1,
    hasHotTub: Boolean(data.hasHotTub),
    hotTubService: Boolean(data.hotTubService),
    hotTubDrain: Boolean(data.hotTubDrain),
  };
}
