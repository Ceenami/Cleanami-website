export const SERVICE_UNAVAILABLE = {
  database:
    "Database is not configured. Add DATABASE_URL to .env.local to enable this feature.",
  stripe:
    "Payments are not configured. Add STRIPE_SECRET_KEY to .env.local to enable this feature.",
  email:
    "Email is not configured. Add RESEND_API_KEY to .env.local to enable this feature.",
  googleMaps:
    "Address lookup is not configured. Add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to .env.local.",
} as const;

export function isServiceUnavailableMessage(message: string): boolean {
  return Object.values(SERVICE_UNAVAILABLE).some((value) => value === message);
}
