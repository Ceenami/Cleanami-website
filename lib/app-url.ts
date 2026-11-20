import "server-only";
import { siteOrigin, configuredCanonicalOrigin, LEGACY_SITE_ORIGIN } from "@/lib/site-origin";

const DEFAULT_PROD_URL = LEGACY_SITE_ORIGIN;
const DEFAULT_DEV_URL = "http://localhost:3000";

function isLocalHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost")
  );
}

/**
 * Resolves the public site URL for redirects and emails.
 * Normalizes missing schemes and upgrades non-local http to https.
 */
export function getAppBaseUrl(): string {
  const candidates = [
    configuredCanonicalOrigin(),
    process.env.NEXT_PUBLIC_APP_URL?.trim(),
    process.env.NEXT_PUBLIC_SERVER_URL?.trim(),
    process.env.URL?.trim(),
    process.env.DEPLOY_PRIME_URL?.trim(),
  ].filter(Boolean) as string[];

  const isProd = process.env.NODE_ENV === "production";
  for (const candidate of candidates) {
    const origin = siteOrigin(candidate, !isProd);
    if (origin) return origin;
  }
  return isProd ? DEFAULT_PROD_URL : DEFAULT_DEV_URL;
}

/** Stripe Connect requires HTTPS redirect URLs in live mode. */
export function getStripeRedirectBaseUrl(): string {
  const base = getAppBaseUrl();

  try {
    const parsed = new URL(base);
    if (!isLocalHost(parsed.hostname)) {
      parsed.protocol = "https:";
      return parsed.toString().replace(/\/$/, "");
    }
  } catch {
    return DEFAULT_PROD_URL;
  }

  return base;
}
