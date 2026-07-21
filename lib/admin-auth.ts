import "server-only";

import { createClient } from "@/lib/supabase/server";
import { isAdminRole } from "@/lib/auth/roles";
import { resolveRoleFromDatabase } from "@/lib/auth/server-roles";
import type { NextRequest } from "next/server";

export type AdminAuthResult = {
  isAdmin: boolean;
  userRole: string | undefined;
  error: string | null;
};

/**
 * Resolves admin access for API routes. The role is read from the application
 * DB (`users.role`) — the authoritative source — never from the client-editable
 * `user_metadata`. Supports the cookie session, a Bearer access token, and the
 * getUser() fallback for resolving the caller's identity.
 */
export async function getAdminAuth(
  request?: NextRequest | Request
): Promise<AdminAuthResult> {
  const supabase = await createClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims as Record<string, unknown> | undefined;

  let supabaseUserId =
    typeof claims?.sub === "string" ? claims.sub : undefined;
  let email = typeof claims?.email === "string" ? claims.email : undefined;

  if (!supabaseUserId) {
    const authHeader = request?.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const { data, error } = await supabase.auth.getUser(authHeader.slice(7));
      if (!error && data.user) {
        supabaseUserId = data.user.id;
        email = data.user.email ?? email;
      }
    }
  }

  if (!supabaseUserId) {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return {
        isAdmin: false,
        userRole: undefined,
        error: userError?.message ?? "Unauthorized",
      };
    }

    supabaseUserId = userData.user.id;
    email = userData.user.email ?? email;
  }

  const userRole = await resolveRoleFromDatabase(supabaseUserId, email);
  const isAdmin = isAdminRole(userRole);

  if (!isAdmin) {
    return {
      isAdmin: false,
      userRole,
      error: "Unauthorized",
    };
  }

  return { isAdmin: true, userRole, error: null };
}
