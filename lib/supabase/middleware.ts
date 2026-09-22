import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasEnvVars } from "../utils";
import { isAdminRole, trustedRoleFromClaims } from "@/lib/auth/roles";
import { bearerTokenFromHeader } from "@/lib/auth/bearer-token";

const allowedOrigins = [
  // iOS Capacitor default.
  'capacitor://localhost',
  // Android with `androidScheme: 'https'` (see the app's capacitor.config.ts).
  // Without this the native app's requests are blocked by CORS even when they
  // authenticate correctly.
  'https://localhost',
  'http://localhost',
  'http://localhost:8080',
];

export async function updateSession(request: NextRequest) {
  const origin = request.headers.get('origin');
  const pathname = request.nextUrl.pathname;
  if (
    request.method === 'OPTIONS' &&
    pathname.startsWith('/api') &&
    origin &&
    allowedOrigins.includes(origin)
  ) {
    return new NextResponse(null, {
      status: 204, // No Content
      headers: {
        'Access-Control-Allow-Origin': origin,
        // PATCH is required by the native app: evidence submission
        // (`PATCH /api/cleaner/jobs/[id]/evidence`), onboarding saves and
        // marking notifications read all use it. Omitting it fails the
        // preflight, which surfaces in the app as "Failed to fetch".
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key', // Add any other headers your client sends
        'Access-Control-Max-Age': '86400', // Cache preflight response for 24 hours
      },
    });
  }


  let supabaseResponse = NextResponse.next({
    request,
  });

  // If the env vars are not set, skip middleware check. You can remove this
  // once you setup the project.
  if (!hasEnvVars) {
    return supabaseResponse;
  }

  // With Fluid compute, don't put this client in a global environment
  // variable. Always create a new one on each request.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not run code between createServerClient and
  // supabase.auth.getClaims(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  // IMPORTANT: If you remove getClaims() and you use server-side rendering
  // with the Supabase client, your users may be randomly logged out.
  // The native cleaner app sends a Bearer token and no cookies, so a bare
  // `getClaims()` resolves nothing and every /api/cleaner/* call would be
  // rejected below before reaching its route handler. `getClaims(token)`
  // verifies the signature, so this widens who can authenticate, not what an
  // unauthenticated caller may do.
  const bearerToken = bearerTokenFromHeader(
    request.headers.get("authorization")
  );
  // `getClaims` only turns Supabase's own AuthErrors into a returned `error`;
  // every other failure it rethrows. On the Bearer path that includes the plain
  // `Error("JWT has expired")` / `Error("Missing exp claim")` from its own `exp`
  // check, `Error("Invalid alg claim")`, and a WebCrypto throw on a malformed
  // signing key. None of those are AuthErrors, so unhandled they escape the
  // middleware and crash the Edge Function.
  //
  // The cookie path can't hit this — `getClaims()` with no argument refreshes
  // via `getSession()` first, so `exp` is always fresh. A Bearer token is held
  // by the client with nothing to refresh from, so the native app presenting a
  // stale one is routine, not exceptional. Treat any failure as "no
  // authenticated user" and let the guards below answer 401/redirect.
  const { data } = await supabase.auth
    .getClaims(bearerToken ?? undefined)
    .catch(() => ({ data: null }));
  const user = data?.claims;
  // Authoritative-at-the-edge role: `app_metadata.role` is set only by the
  // service role and cannot be self-edited by the client (unlike
  // `user_metadata.role`). Node route guards additionally re-check `users.role`.
  const userRole = trustedRoleFromClaims(user);

  // const protectedCustomerRoutesList = [
  //   "/customers",
  //   "/customers/dashboard",
  //   "/customers/*",
  //   "/portal",
  //   "/portal/*"
  // ];

  // const protectedAdminRoutesList = [
  //   "/admin",
  //   "/admin/dashboard",
  //   "/admin/*",
  // ];

  // const isProtectedCustomerRoute = protectedCustomerRoutesList.some(
  //   (route) =>
  //     request.nextUrl.pathname === route ||
  //     request.nextUrl.pathname.startsWith(route + "/")
  // );

  // const isProtectedAdminRoute = protectedAdminRoutesList.some(
  //   (route) =>
  //     request.nextUrl.pathname === route ||
  //     request.nextUrl.pathname.startsWith(route + "/")
  // );

  
  

   const isProtectedCustomerRoute = 
    pathname.startsWith('/customer');

    const isProtectedAdminRoute = pathname.startsWith('/admin');

  const isProtectedCleanerRoute = pathname.startsWith('/cleaner');
  const isCleanerApiRoute =
    pathname === '/api/cleaner' || pathname.startsWith('/api/cleaner/');

  const isAdmin = isAdminRole(userRole);
  const isCleaner = userRole === 'cleaner';


  // 1. Redirect unauthenticated users from protected customer routes
  if (!user && isProtectedCustomerRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    return NextResponse.redirect(url);
  }

  // 2. Redirect unauthenticated users from protected admin routes
  if (!user && isProtectedAdminRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    return NextResponse.redirect(url);
  }

  if (user && isProtectedAdminRoute && !isAdmin) {
    const url = request.nextUrl.clone();
    url.pathname = "/customer/dashboard";
    return NextResponse.redirect(url);
  }

  // Admins with a linked property profile can use /customer/* (owner portal).

  // 3. Redirect unauthenticated users from protected cleaner routes
  if (!user && isProtectedCleanerRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    return NextResponse.redirect(url);
  }

  // 4. Redirect non-cleaners away from cleaner portal
  if (user && isProtectedCleanerRoute && !isCleaner) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    return NextResponse.redirect(url);
  }

  // 5. Block non-cleaners from cleaner API routes
  if (isCleanerApiRoute && (!user || !isCleaner)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  
  if (
    pathname.startsWith('/api') &&
    origin &&
    allowedOrigins.includes(origin)
  ) {
    supabaseResponse.headers.set('Access-Control-Allow-Origin', origin);
    supabaseResponse.headers.set('Access-Control-Allow-Credentials', 'true');
  }
  

  // IMPORTANT: You *must* return the supabaseResponse object as it is.
  // If you're creating a new response object with NextResponse.next() make sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Change the myNewResponse object to fit your needs, but avoid changing
  //    the cookies!
  // 4. Finally:
  //    return myNewResponse
  // If this is not done, you may be causing the browser and server to go out
  // of sync and terminate the user's session prematurely!

  return supabaseResponse;
}