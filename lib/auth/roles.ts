/**
 * Edge-safe role helpers. This module intentionally has ZERO Node/DB imports so
 * it can be used from the Edge middleware. Do not import `@/db`, `server-only`,
 * or anything that pulls in Node built-ins here.
 */

export const ADMIN_ROLES = ["admin", "super_admin"] as const;

export type AppRole = "user" | "cleaner" | "admin" | "super_admin";

export function isAdminRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "super_admin";
}

export function isCleanerRole(role: string | null | undefined): boolean {
  return role === "cleaner";
}

/**
 * Reads the role from Supabase `app_metadata` — the only role claim a user
 * cannot self-edit (it is writable solely by the service role). This is the
 * trusted role source for the Edge middleware, which cannot reach the DB.
 *
 * NEVER read `user_metadata.role` for an authorization decision: the client can
 * set it with `supabase.auth.updateUser({ data: { role } })`. `user_metadata`
 * is kept populated for display only; authorization reads the DB (`users.role`)
 * server-side and this trusted claim at the edge.
 */
export function trustedRoleFromClaims(
  claims: Record<string, unknown> | null | undefined
): string | undefined {
  const appMetadata = claims?.app_metadata;
  if (
    appMetadata &&
    typeof appMetadata === "object" &&
    "role" in appMetadata
  ) {
    const role = (appMetadata as { role?: unknown }).role;
    if (typeof role === "string") return role;
  }
  return undefined;
}
