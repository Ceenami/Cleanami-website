import { SERVICE_TYPES, type ServiceType } from "@/lib/constants/service-type";

/**
 * How a saved booking session says which wizard it belongs to.
 *
 * `onboarding_sessions.form_data` is a jsonb blob shared by both flows — no
 * migration, and both of the route's serialisers spread unknown keys rather
 * than whitelisting (checked, not assumed). One extra key inside it is enough
 * to route a resumed session back to the form it came from.
 *
 * **A session saved before this key existed has no value here**, and every one
 * of those is a vacation-rental session, because that was the only wizard.
 * `readSessionServiceType` returning `null` is what the caller reads as "the
 * old product", which is how a customer mid-funnel when this shipped lands back
 * on the step they left rather than on a question they have never seen.
 */
export const SESSION_SERVICE_TYPE_KEY = "serviceType";

export function readSessionServiceType(
  formData: Record<string, unknown> | null | undefined
): ServiceType | null {
  const raw = formData?.[SESSION_SERVICE_TYPE_KEY];
  return typeof raw === "string" && (SERVICE_TYPES as readonly string[]).includes(raw)
    ? (raw as ServiceType)
    : null;
}
