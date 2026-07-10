import { resolveAuthCallbackDestination } from "@/lib/auth-redirects";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const requestedNext = searchParams.get("next");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const { data } = await supabase.auth.getClaims();
      const role = data?.claims?.user_metadata?.role as string | undefined;
      const destination = resolveAuthCallbackDestination(role, requestedNext);

      return NextResponse.redirect(`${origin}${destination}`);
    }
  }

  return NextResponse.redirect(
    `${origin}/sign-in?error=${encodeURIComponent("Could not complete sign-in. Try again or request a new link.")}`
  );
}
