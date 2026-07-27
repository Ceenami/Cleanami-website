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

/**
 * Revives a saved booking form that came back over JSON.
 *
 * `GET /api/onboarding/session` returns `firstCleanDate` as a `Date`, but
 * `NextResponse.json` flattens it to an ISO **string** on the wire. Merging that
 * string straight into form state left `z.date()` rejecting a resumed booking at
 * the subscription step ("Please select a valid start date") with a date visibly
 * selected, and handed date-fns `format()` a string it treats as Invalid Date.
 * Server actions (`loadSession`) are unaffected — RSC preserves `Date` — so only
 * the JSON route needs this.
 */
export function reviveSignupFormDataFromJson(
  data: Partial<SerializableSignupFormData> | undefined | null
): Partial<SignupFormData> {
  if (!data) return {};

  const { firstCleanDate, ...rest } = data;
  const revived = firstCleanDate ? new Date(firstCleanDate) : undefined;

  return {
    ...(rest as Partial<SignupFormData>),
    ...(revived && !Number.isNaN(revived.getTime())
      ? { firstCleanDate: revived }
      : {}),
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
