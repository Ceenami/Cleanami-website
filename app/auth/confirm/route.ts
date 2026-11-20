import { createClient } from "@/lib/supabase/server";
import { resolveAuthCallbackDestination, signInReturnPath } from "@/lib/auth-redirects";
import { resolveRoleFromDatabase } from "@/lib/auth/server-roles";
import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/**
 * Entry point for emailed auth links (confirmation, magic link, password
 * recovery).
 *
 * Supabase returns the session in one of two shapes depending on the flow the
 * client was created with, so handle both rather than assuming one:
 *   - `?token_hash=…&type=…` -> `verifyOtp`
 *   - `?code=…`              -> `exchangeCodeForSession` (the PKCE shape
 *                               `@supabase/ssr` uses by default)
 *
 * `next` is validated before it is used: it arrives from a URL a stranger can
 * craft, so an unchecked value would turn this into an open redirect.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  const requestedNext = searchParams.get("next");
  try {
    const supabase = await createClient();
    async function destinationAfterVerification() {
      // Keep the existing OTP and PKCE password recovery route independent of
      // portal navigation and of DB profile availability.
      if (type === "recovery" || (code && requestedNext === "/reset-password"))
        return NextResponse.redirect(`${origin}/reset-password`);
      const { data } = await supabase.auth.getClaims();
      const claims = data?.claims as Record<string, unknown> | undefined;
      if (typeof claims?.sub !== "string") return null;
      const role = await resolveRoleFromDatabase(claims.sub, typeof claims.email === "string" ? claims.email : undefined);
      if (!role) return null;
      return NextResponse.redirect(`${origin}${resolveAuthCallbackDestination(role, requestedNext)}`);
    }

    if (tokenHash && type) {
      const { error } = await supabase.auth.verifyOtp({
        type,
        token_hash: tokenHash,
      });

      if (!error) {
        const response = await destinationAfterVerification();
        if (response) return response;
      }
    } else if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (!error) {
        const response = await destinationAfterVerification();
        if (response) return response;
      }
    }
  } catch {
    // A provider outage must not drop a legitimate portal return destination.
  }

  return NextResponse.redirect(
    `${origin}${signInReturnPath(requestedNext, "Could not verify your login link. Request a new one from /sign-in.")}`
  );
}
