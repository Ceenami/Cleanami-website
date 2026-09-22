import { updateSession } from "@/lib/supabase/middleware";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  // This matcher spans the entire site — every page and every /api route — so
  // an uncaught throw in here does not break one route, it 500s everything at
  // once and Netlify reports the Edge Function as crashed. Fail open to the
  // unmodified request instead: the Node route guards re-check `users.role`
  // server-side, so a request that skips the edge check is still authorized
  // before it can read or write anything.
  try {
    return await updateSession(request);
  } catch (error) {
    console.error("middleware: falling through after an unhandled error", error);
    return NextResponse.next({ request });
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - images - .svg, .png, .jpg, .jpeg, .gif, .webp
     * Feel free to modify this pattern to include more paths.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
