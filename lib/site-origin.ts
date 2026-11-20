/** Pure origin helpers usable by the edge middleware and client tracking. */
export const LEGACY_SITE_ORIGIN = "https://cleannami.ceenami.com";
export const PRODUCTION_TRACKING_HOSTS = ["cleannami.ceenami.com", "cleannami.com", "www.cleannami.com"];
export function siteOrigin(value: string | undefined, allowLocal = false): string | null {
  if (!value?.trim()) return null;
  try {
    const input = value.trim();
    if (input.startsWith("//")) return null;
    const explicitScheme = input.includes("://");
    const url = new URL(explicitScheme ? input : `https://${input}`);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname.endsWith(".localhost");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/" || (!allowLocal && local)) return null;
    if (!local) url.protocol = "https:";
    else if (!explicitScheme) url.protocol = "http:";
    return url.origin;
  } catch { return null; }
}
export function configuredCanonicalOrigin(): string | null {
  if (process.env.CANONICAL_DOMAIN_REDIRECTS_ENABLED !== "true") return null;
  return siteOrigin(process.env.CANONICAL_SITE_URL);
}
/** Preserve API methods, OAuth callbacks and signed provider URLs on their configured host. */
export function canonicalPageRedirect(requestUrl: string, method: string): string | null {
  if (!["GET", "HEAD"].includes(method.toUpperCase())) return null;
  const canonical = configuredCanonicalOrigin(); if (!canonical) return null;
  let url: URL, path: string;
  try { url = new URL(requestUrl); path = decodeURIComponent(url.pathname).toLowerCase(); } catch { return null; }
  if (/^\/(api|auth|_next|_netlify|\.netlify|\.well-known)(\/|$)/.test(path)) return null;
  const aliases = (process.env.LEGACY_SITE_HOSTS || "cleannami.ceenami.com,cleanami.ceenami.com").split(",").map(host => host.trim().toLowerCase()).filter(Boolean);
  if (!aliases.includes(url.hostname.toLowerCase()) || url.origin === canonical) return null;
  const target = new URL(canonical); target.pathname = url.pathname; target.search = url.search;
  return target.toString();
}
