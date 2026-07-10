import "server-only";

const DEFAULT_PROD_URL = "https://cleanami.ceenami.com";
const DEFAULT_DEV_URL = "http://localhost:3000";

function isLocalHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".localhost")
  );
}

/**
 * Resolves the public site URL for redirects and emails.
 * Normalizes missing schemes and upgrades non-local http to https.
 */
export function getAppBaseUrl(): string {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL?.trim(),
    process.env.NEXT_PUBLIC_SERVER_URL?.trim(),
    process.env.URL?.trim(),
    process.env.DEPLOY_PRIME_URL?.trim(),
  ].filter(Boolean) as string[];

  const isProd = process.env.NODE_ENV === "production";
  const raw =
    candidates.find((value) => !isProd || !looksLikeLocalDevUrl(value)) ??
    (isProd ? DEFAULT_PROD_URL : DEFAULT_DEV_URL);

  let url = raw.replace(/\/$/, "");

  if (!/^https?:\/\//i.test(url)) {
    const hostOnly = url.split("/")[0];
    url = `${isLocalHost(hostOnly) ? "http" : "https"}://${url}`;
  }

  try {
    const parsed = new URL(url);
    if (!isLocalHost(parsed.hostname) && parsed.protocol === "http:") {
      parsed.protocol = "https:";
      url = parsed.toString().replace(/\/$/, "");
    }
  } catch {
    return isProd ? DEFAULT_PROD_URL : DEFAULT_DEV_URL;
  }

  return url;
}

function looksLikeLocalDevUrl(value: string): boolean {
  const normalized = /^https?:\/\//i.test(value) ? value : `http://${value}`;
  try {
    return isLocalHost(new URL(normalized).hostname);
  } catch {
    return /localhost|127\.0\.0\.1/i.test(value);
  }
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
