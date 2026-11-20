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

/** Keep auth cookies and redirects on the public host behind the Netlify proxy. */
export function getAuthResponseOrigin(request: Request): string {
  const incoming = new URL(request.url);
  const allowLocal = process.env.NODE_ENV !== "production";
  if (allowLocal && isLocalHost(incoming.hostname)) return incoming.origin;

  const configured = siteOrigin(process.env.NEXT_PUBLIC_APP_URL, allowLocal);
  const allowed = new Set([incoming.origin]);
  if (configured) allowed.add(configured);
  const productionOrigins = [LEGACY_SITE_ORIGIN, "https://cleannami.com", "https://www.cleannami.com"];
  if (productionOrigins.includes(incoming.origin) || (configured && productionOrigins.includes(configured))) {
    for (const origin of productionOrigins) allowed.add(origin);
  }

  for (const name of ["x-forwarded-host", "host"]) {
    const host = request.headers.get(name)?.trim();
    // A forwarded header is useful only for a known host, never an arbitrary URL.
    if (!host || /[\s,/@\\?#]/.test(host)) continue;
    const origin = siteOrigin(`https://${host}`, allowLocal);
    if (origin && origin !== incoming.origin && allowed.has(origin)) return origin;
  }

  // Some Netlify requests expose only the immutable deploy URL. Restrict the
  // fallback to the configured stable host of that exact same Netlify project.
  const deployment = incoming.hostname.match(/^[a-f0-9]{24}--(.+\.netlify\.app)$/i);
  if (deployment && configured) {
    const publicHost = new URL(configured).hostname;
    if (publicHost === deployment[1] || publicHost.endsWith(`--${deployment[1]}`)) return configured;
  }
  return incoming.origin;
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
