import type { ResidentialFormData } from "./index";

/**
 * Client → server payload for the residential booking form.
 *
 * The vacation-rental form needs `serialize-signup-form.ts` because it carries
 * a `Date` and a `File[]` that JSON cannot express. The residential form
 * deliberately carries **neither**: the clean date is a `YYYY-MM-DD` string
 * from the moment the customer picks it, so there is no `Date` to revive and
 * no timezone to lose on the way across. That is the point — `firstCleanDate`
 * being a real `Date` is what produced the resumed-session bug the sibling
 * module's comment records.
 *
 * What is left is the coercion half, which is not optional. Numbers arrive from
 * text inputs and booleans arrive from JSON and from `jsonb` — and
 * `Boolean("false")` is `true` (the defect that billed a pet fee on
 * properties with no pets).
 */
export type SerializableResidentialFormData = ResidentialFormData;

export function serializeResidentialFormForServer(
  formData: ResidentialFormData
): SerializableResidentialFormData {
  return { ...formData };
}

/** See `toBooleanish` in `serialize-signup-form.ts` — same reason, same shape. */
function toBooleanish(value: unknown): boolean {
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v === "true" || v === "1" || v === "yes" || v === "on";
  }
  if (typeof value === "number") return value !== 0;
  return value === true;
}

/** Trimmed, or undefined — never an empty string, which would store as `''` not NULL. */
function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Coerce a payload that has been through JSON so the server prices and
 * validates exactly what the form showed. Every server entry point runs this
 * first, for the same reason `normalizeSignupFormDataForPricing` exists: the
 * create-intent re-price and the completion re-price must agree to the cent, or
 * a booking is rejected after the customer has already been charged.
 */
export function normalizeResidentialFormData(
  data: ResidentialFormData
): ResidentialFormData {
  return {
    ...data,
    name: optionalText(data.name),
    email: optionalText(data.email)?.toLowerCase(),
    emailConfirm: optionalText(data.emailConfirm)?.toLowerCase(),
    phoneNumber: optionalText(data.phoneNumber),
    address: optionalText(data.address),
    bedrooms: Number(data.bedrooms) || 0,
    bathrooms: Number(data.bathrooms) || 0,
    sqft: Number(data.sqft) || 0,
    petsAllowed: toBooleanish(data.petsAllowed),
    hasHotTub: toBooleanish(data.hasHotTub),
    hotTubService: toBooleanish(data.hotTubService),
    isAddressInServiceArea: toBooleanish(data.isAddressInServiceArea),
    entryMethod: data.entryMethod,
    entryInstructions: optionalText(data.entryInstructions),
    parkingInstructions: optionalText(data.parkingInstructions),
    specialNotes: optionalText(data.specialNotes),
  };
}
