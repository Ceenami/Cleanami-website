import { NextResponse } from "next/server";
import { z } from "zod";
import { db, getDbOrNull } from "@/db";
import { createPublicFormClient } from "@/lib/supabase/server";
import { AuthService } from "@/lib/services/auth/auth.service";
import { CLEANER_SIGNUP_REJECTED_MESSAGE } from "@/lib/queries/cleaner-invitations";
import { SERVICE_UNAVAILABLE } from "@/lib/env/messages";

/**
 * Cleaner sign-up for the native app.
 *
 * WHY THIS EXISTS: the app used to call `supabase.auth.signUp()` directly with
 * `user_metadata.user_type = 'cleaner'`, which is served by the Postgres trigger
 * `handle_new_cleaner_user`. That trigger creates the `users` and `cleaners`
 * rows with **no `invitation_id`** and never marks the invitation `signed_up` —
 * only the website's sign-up action does either. Two consequences, both bad:
 *
 *   1. Anyone holding the anon key could create a cleaner account. The
 *      invitation allowlist was enforced on the website and nowhere else.
 *   2. `getCleanerAuth()` refuses a cleaner with neither `invitation_id` nor
 *      `onboarding_completed`, so an app-created cleaner was 401'd out of every
 *      `/api/cleaner/*` route — signed up successfully and unable to do
 *      anything at all.
 *
 * So this route does not reimplement sign-up; it runs the same
 * `AuthService.signUpUser` the website's `/sign-up` form does. Allowlist check,
 * invitation linkage, `signed_up` transition, audit trail and the trusted
 * `app_metadata.role` claim are therefore identical by construction rather than
 * by two implementations agreeing for now.
 *
 * NOT under `/api/cleaner/` on purpose: the Edge middleware 401s every
 * unauthenticated request to that prefix (`isCleanerApiRoute`), and by
 * definition nobody signing up has a session yet.
 *
 * The client supabase key can still reach `auth.signUp` directly — that is a
 * property of a public anon key, not something a route can close. Migration
 * 0035 closes it in the trigger itself.
 */

const bodySchema = z.object({
  email: z.string().trim().min(1),
  password: z.string().min(1),
  confirmPassword: z.string().min(1),
  name: z.string().trim().optional(),
});

export async function POST(request: Request) {
  if (!getDbOrNull()) {
    return NextResponse.json(
      { error: SERVICE_UNAVAILABLE.database },
      { status: 503 }
    );
  }

  let parsed;
  try {
    parsed = bodySchema.safeParse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // `role` is pinned here rather than read from the body: this endpoint exists
  // for the cleaner app, and a caller must never be able to ask for another.
  const supabase = createPublicFormClient();
  const result = await new AuthService(supabase, db).signUpUser({
    ...parsed.data,
    role: "cleaner",
  });

  if (result.success) {
    return NextResponse.json({ success: true });
  }

  const message = result.error?.message ?? "Sign up failed. Please try again.";

  // Compared against the exported constant, not sniffed for a substring, so the
  // status stays correct if the wording changes.
  const rejected = message === CLEANER_SIGNUP_REJECTED_MESSAGE;

  return NextResponse.json(
    { error: message, code: rejected ? "not_invited" : undefined },
    { status: rejected ? 403 : 400 }
  );
}
