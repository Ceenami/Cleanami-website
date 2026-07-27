import { NextResponse } from "next/server";
import {
  getSessionIdentity,
  resolveRoleFromDatabase,
  syncRoleToAppMetadata,
} from "@/lib/auth/server-roles";

/**
 * Mirrors the caller's authoritative DB role into their `app_metadata.role`.
 *
 * WHY THIS EXISTS: the Edge middleware authorizes on `app_metadata.role`,
 * which only the service role can write. The native cleaner app signs users up
 * with `supabase.auth.signUp`, and a client can only ever write
 * `user_metadata` — so an app-created cleaner has no trusted claim and is
 * locked out of every `/api/cleaner/*` route and the `/cleaner` portal until
 * something server-side fills it in. That something is this route.
 *
 * SAFETY: it accepts no input. The role is read from `users.role` — the same
 * column every server-side guard already treats as authoritative — keyed on the
 * caller's own verified identity. It can only ever write back what the database
 * already says, so it cannot be used to escalate.
 *
 * NOTE FOR CALLERS: `app_metadata` is baked into the JWT at issue time, so the
 * new claim does not appear until the session is refreshed. Call
 * `supabase.auth.refreshSession()` after this returns.
 */
export async function POST() {
  const { supabaseUserId, email } = await getSessionIdentity();

  if (!supabaseUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = await resolveRoleFromDatabase(supabaseUserId, email);

  if (!role) {
    // Authenticated with Supabase but has no application profile yet. The
    // caller should finish sign-up before retrying.
    return NextResponse.json(
      { error: "No application profile for this account" },
      { status: 404 }
    );
  }

  await syncRoleToAppMetadata(supabaseUserId, role);

  return NextResponse.json({ role, synced: true });
}
