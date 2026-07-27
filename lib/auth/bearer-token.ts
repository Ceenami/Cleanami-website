/**
 * Edge-safe Bearer-token extraction. This module intentionally has ZERO
 * Node/DB imports so the Edge middleware can use it. Do not import `@/db`,
 * `server-only`, `next/headers`, or anything pulling in Node built-ins here.
 */

/** Three base64url segments — enough to tell a JWT from an opaque secret. */
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/**
 * Pulls a Supabase JWT out of an `Authorization: Bearer <token>` header value.
 *
 * The native cleaner app (CleanWaves) authenticates with a JWT rather than a
 * session cookie, so its requests carry no cookies at all. Every cookie-only
 * auth path — the Edge middleware and `createClient()` — must consult this too,
 * or those requests 401 before reaching any route handler.
 *
 * Returns null unless the value is shaped like a JWT. Cron routes authenticate
 * with `Authorization: Bearer <CRON_SECRET>`, an opaque string; treating that as
 * a session token would attach a garbage credential to PostgREST.
 */
export function bearerTokenFromHeader(
  rawHeader: string | null | undefined
): string | null {
  if (!rawHeader) return null;

  const match = /^Bearer\s+(.+)$/i.exec(rawHeader.trim());
  const token = match?.[1]?.trim();
  if (!token || !JWT_SHAPE.test(token)) return null;

  return token;
}
