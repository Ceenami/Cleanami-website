import { db } from "@/db";
import { sql } from "drizzle-orm";

/**
 * Fires the T-60 ETA / reliability-check prompts. Runs the SQL function
 * `send_reliability_notifications()` (defined in functions_for_app.sql, applied
 * by scripts/apply-sql-function_migrations.ts) which inserts reliability_checks
 * + notifications for jobs starting in ~1 hour. Schedule this ~every 15 min.
 */
export async function GET(request: Request) {
  // Fail closed: refuse to run if the secret is missing or mismatched.
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    await db.execute(sql`SELECT send_reliability_notifications()`);
    return new Response(
      JSON.stringify({ success: true, ranAt: new Date().toISOString() }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[cron/reliability-checks]", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
