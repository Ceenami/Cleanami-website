import { resolveAuthCallbackDestination, signInReturnPath } from "@/lib/auth-redirects";
import { createClient } from "@/lib/supabase/server";
import { resolveRoleFromDatabase } from "@/lib/auth/server-roles";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const requestedNext = searchParams.get("next");

  try {
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
        if (supabaseUserId) {
          const role = await resolveRoleFromDatabase(supabaseUserId, email);
          if (role) {
            const destination = resolveAuthCallbackDestination(role, requestedNext);
            return NextResponse.redirect(`${origin}${destination}`);
          }
        }
      }
    }
  } catch {
    // Verification/transport failure retains only the safe destination, never
    // auth codes or raw provider errors in a redirect.
  }

  return NextResponse.redirect(
    `${origin}${signInReturnPath(requestedNext, "Could not complete sign-in. Try again or request a new link.")}`
  );
}
