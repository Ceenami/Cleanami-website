import { createClient as adminClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { bearerTokenFromHeader } from "@/lib/auth/bearer-token";

/**
 * Reads a Supabase JWT off the current request's `Authorization` header.
 * See `bearerTokenFromHeader` for why native callers need this path.
 */
export async function getBearerToken(): Promise<string | null> {
  try {
    const headerStore = await headers();
    return bearerTokenFromHeader(headerStore.get("authorization"));
  } catch {
    // `headers()` throws outside a request scope (e.g. build-time prerender).
    return null;
  }
}

/**
 * Especially important if using Fluid compute: Don't put this client in a
 * global variable. Always create a new client within each function when using
 * it.
 */

// used for rollbacks
export function createAdminClient() {
  return adminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    }
  );
}

// Onboarding form submissions
export function createPublicFormClient() {
  return adminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    }
  );
}

// normal authenticated use
export async function createClient() {
  const cookieStore = await cookies();
  const bearerToken = await getBearerToken();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Native callers have no cookie session, so PostgREST and Storage would
      // otherwise fall back to the anon key and see nothing under RLS. Setting
      // the header here makes those requests run as the cleaner: supabase-js
      // only injects its own Authorization when one is not already present.
      ...(bearerToken
        ? { global: { headers: { Authorization: `Bearer ${bearerToken}` } } }
        : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    },
  );
}
