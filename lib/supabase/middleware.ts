import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasEnvVars } from "../utils";

const allowedOrigins = [
  'capacitor://localhost',
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
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;
  const userRole = user?.user_metadata?.role;

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

  const isAdmin = userRole === 'super_admin' || userRole === 'admin';
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