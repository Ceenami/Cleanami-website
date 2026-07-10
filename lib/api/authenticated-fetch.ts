import { createClient } from "@/lib/supabase/client";

/**
 * Browser fetch that forwards the Supabase access token so API routes can
 * authenticate even when auth cookies are not visible to the Route Handler.
 */
export async function authenticatedFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const headers = new Headers(init?.headers);
  if (session?.access_token) {
    headers.set("Authorization", `Bearer ${session.access_token}`);
  }

  return fetch(input, {
    ...init,
    headers,
    credentials: "same-origin",
  });
}
