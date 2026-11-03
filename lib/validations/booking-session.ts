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
 * `readSessionServiceType` returning `null` identifies that legacy rental
 * draft. The customer still sees both service choices before choosing to resume.
 */
export const SESSION_SERVICE_TYPE_KEY = "serviceType";

/** A freshly created cookie with an empty form is not a booking to resume. */
export function hasSavedBookingProgress(session: {
  currentStep?: number;
  formData?: Record<string, unknown> | null;
}): boolean {
  return (session.currentStep ?? 1) > 1 || Object.values(session.formData ?? {}).some(
    (value) => value !== null && value !== undefined && value !== "",
  );
}

export function readSessionServiceType(
  formData: Record<string, unknown> | null | undefined
): ServiceType | null {
  const raw = formData?.[SESSION_SERVICE_TYPE_KEY];
  return typeof raw === "string" && (SERVICE_TYPES as readonly string[]).includes(raw)
    ? (raw as ServiceType)
    : null;
}
