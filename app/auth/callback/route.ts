import { resolveAuthCallbackDestination } from "@/lib/auth-redirects";
import { createClient } from "@/lib/supabase/server";
import { resolveRoleFromDatabase } from "@/lib/auth/server-roles";
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
      const claims = data?.claims as Record<string, unknown> | undefined;
      const supabaseUserId =
        typeof claims?.sub === "string" ? claims.sub : undefined;
      const email =
        typeof claims?.email === "string" ? claims.email : undefined;
      const role = supabaseUserId
        ? await resolveRoleFromDatabase(supabaseUserId, email)
        : undefined;
      const destination = resolveAuthCallbackDestination(role, requestedNext);

      return NextResponse.redirect(`${origin}${destination}`);
    }
  }

  return NextResponse.redirect(
    `${origin}/sign-in?error=${encodeURIComponent("Could not complete sign-in. Try again or request a new link.")}`
  );
}
