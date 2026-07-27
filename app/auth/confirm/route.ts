import { createClient } from "@/lib/supabase/server";
import { isSafeRedirectPath } from "@/lib/auth-redirects";
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
  const next =
    requestedNext && isSafeRedirectPath(requestedNext)
      ? requestedNext
      : "/customer/dashboard";

  const supabase = await createClient();

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(
    `${origin}/sign-in?error=${encodeURIComponent("Could not verify your login link. Request a new one from /sign-in.")}`
  );
}
