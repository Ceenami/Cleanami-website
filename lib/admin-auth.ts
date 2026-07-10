import "server-only";

import { getDbOrNull } from "@/db";
import { users } from "@/db/schemas";
import { createClient } from "@/lib/supabase/server";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

export type AdminAuthResult = {
  isAdmin: boolean;
  userRole: string | undefined;
  error: string | null;
};

function isAdminRole(role: string | undefined): boolean {
  return role === "admin" || role === "super_admin";
}

function roleFromClaims(
  claims: Record<string, unknown> | undefined
): string | undefined {
  const metadata = claims?.user_metadata;
  if (metadata && typeof metadata === "object" && "role" in metadata) {
    const role = (metadata as { role?: unknown }).role;
    if (typeof role === "string") return role;
  }
  if (typeof claims?.role === "string") return claims.role;
  return undefined;
}

async function resolveRoleFromDatabase(
  supabaseUserId: string,
  email?: string
): Promise<string | undefined> {
  const database = getDbOrNull();
  if (!database) return undefined;

  const byId = await database.query.users.findFirst({
    where: eq(users.supabaseUserId, supabaseUserId),
    columns: { role: true },
  });
  if (byId?.role) return byId.role;

  if (email) {
    const byEmail = await database.query.users.findFirst({
      where: eq(users.email, email.toLowerCase()),
      columns: { role: true },
    });
    return byEmail?.role ?? undefined;
  }

  return undefined;
}

/**
 * Resolves admin access for API routes. Matches the getClaims() flow used by
 * working admin routes, then falls back to Bearer token, getUser(), and DB role.
 */
export async function getAdminAuth(
  request?: NextRequest | Request
): Promise<AdminAuthResult> {
  const supabase = await createClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims as Record<string, unknown> | undefined;

  let supabaseUserId =
    typeof claims?.sub === "string" ? claims.sub : undefined;
  let userRole = roleFromClaims(claims);
  const claimsEmail =
    typeof claims?.email === "string" ? claims.email : undefined;

  if (!supabaseUserId) {
    const authHeader = request?.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const { data, error } = await supabase.auth.getUser(authHeader.slice(7));
      if (!error && data.user) {
        supabaseUserId = data.user.id;
        userRole =
          (data.user.user_metadata?.role as string | undefined) ?? userRole;
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
    userRole =
      (userData.user.user_metadata?.role as string | undefined) ?? userRole;
  }

  if (!isAdminRole(userRole) && supabaseUserId) {
    const dbRole = await resolveRoleFromDatabase(
      supabaseUserId,
      claimsEmail
    );
    if (isAdminRole(dbRole)) {
      userRole = dbRole;
    }
  }

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
