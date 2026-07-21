import "server-only";

import { timingSafeEqual } from "crypto";

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

/** Constant-time string comparison that also masks length differences. */
function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Compare a buffer against itself so the work (and timing) is comparable
    // even when the lengths differ, then fail.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/**
 * Fail-closed cron authentication. Returns a 401 `Response` when the request is
 * not authorized, or `null` when it is.
 *
 * - Refuses to run if `CRON_SECRET` is unset (never trust a blank secret, which
 *   would otherwise make the guard `"Bearer undefined"` / `undefined` guessable).
 * - Uses a constant-time comparison of the Bearer token against the secret.
 */
export function assertCronAuth(request: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error(
      "[cron] CRON_SECRET is not set — refusing to run (fail closed)."
    );
    return unauthorized();
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : "";

  if (!token || !timingSafeEqualStr(token, secret)) {
    return unauthorized();
  }

  return null;
}
