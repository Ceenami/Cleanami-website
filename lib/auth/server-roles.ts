import "server-only";

import { getDbOrNull } from "@/db";
import { users } from "@/db/schemas";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { eq } from "drizzle-orm";

/**
 * Authoritative role lookup: reads `users.role` from the application DB. This is
 * the single source of truth for every server-side authorization decision — it
 * is never derived from the client-editable `user_metadata`.
 */
export async function resolveRoleFromDatabase(
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

export type SessionIdentity = {
  supabaseUserId?: string;
  email?: string;
};

/** Resolves the signed-in user's id + email from the session cookie. */
export async function getSessionIdentity(): Promise<SessionIdentity> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims as Record<string, unknown> | undefined;
  return {
    supabaseUserId: typeof claims?.sub === "string" ? claims.sub : undefined,
    email: typeof claims?.email === "string" ? claims.email : undefined,
  };
}

/** Authoritative role for the current session (DB `users.role`). */
export async function getSessionRole(): Promise<string | undefined> {
  const { supabaseUserId, email } = await getSessionIdentity();
  if (!supabaseUserId) return undefined;
  return resolveRoleFromDatabase(supabaseUserId, email);
}

/**
 * The current session's application `users.id` — the value foreign keys point
 * at, which is NOT the Supabase auth uid (that is `users.supabase_user_id`).
 * Returns null when there is no session or no matching app user.
 */
export async function getAppUserIdForSupabaseUser(): Promise<string | null> {
  const { supabaseUserId } = await getSessionIdentity();
  if (!supabaseUserId) return null;

  const database = getDbOrNull();
  if (!database) return null;

  const row = await database.query.users.findFirst({
    where: eq(users.supabaseUserId, supabaseUserId),
    columns: { id: true },
  });

  return row?.id ?? null;
}

/**
 * Mirrors the authoritative DB role into Supabase `app_metadata` (service-role
 * only) so the Edge middleware can read a trusted, non-user-editable claim
 * without a DB round-trip. Safe no-op when the service key is absent.
 *
 * Existing users are backfilled by `scripts/backfill-app-metadata-roles.ts`.
 */
export async function syncRoleToAppMetadata(
  supabaseUserId: string,
  role: string
): Promise<void> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const supabaseAdmin = createAdminClient();
    await supabaseAdmin.auth.admin.updateUserById(supabaseUserId, {
      app_metadata: { role },
    });
  } catch (error) {
    console.warn(
      "[syncRoleToAppMetadata] could not sync app_metadata:",
      error
    );
  }
}
