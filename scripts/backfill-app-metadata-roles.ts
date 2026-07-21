// scripts/backfill-app-metadata-roles.ts
//
// One-time, idempotent (re-runnable) backfill: copies each user's authoritative
// DB role (`users.role`) into Supabase `app_metadata.role`.
//
// WHY: the Edge middleware reads `app_metadata.role` as the trusted,
// non-user-editable role claim (a user cannot set `app_metadata` themselves —
// only the service role can). Users created before this claim was written have
// no `app_metadata.role`, so the middleware would treat them as unprivileged
// until they are backfilled.
//
// WHEN TO RUN:
//   * once, as part of deploying the M2 role-hardening change, and
//   * any time you create an admin/super_admin out-of-band (e.g. directly in
//     the Supabase dashboard) — re-running is safe.
//
//   corepack pnpm tsx scripts/backfill-app-metadata-roles.ts
//
import { config } from "dotenv";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

// Scripts read .env.local (like drizzle); also load .env for app-only secrets
// such as SUPABASE_SERVICE_ROLE_KEY. dotenv does not override already-set vars.
config({ path: ".env.local" });
config({ path: ".env" });

const DATABASE_URL = process.env.DATABASE_URL;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL is not set");
  process.exit(1);
}
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "❌ NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set"
  );
  process.exit(1);
}

async function backfill() {
  const sql = postgres(DATABASE_URL!, { max: 1 });
  const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let updated = 0;
  let failed = 0;

  try {
    const rows = await sql<{ supabase_user_id: string; role: string }[]>`
      SELECT supabase_user_id, role FROM users
    `;

    console.log(`Found ${rows.length} user(s) to backfill.`);

    for (const row of rows) {
      const { error } = await admin.auth.admin.updateUserById(
        row.supabase_user_id,
        { app_metadata: { role: row.role } }
      );

      if (error) {
        failed += 1;
        console.warn(
          `⚠️  ${row.supabase_user_id} (${row.role}): ${error.message}`
        );
      } else {
        updated += 1;
      }
    }

    console.log(`✅ Backfilled ${updated} user(s); ${failed} failed.`);
    if (failed > 0) process.exitCode = 1;
  } catch (error) {
    console.error("❌ Backfill error:", error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

backfill();
