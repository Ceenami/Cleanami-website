import { db } from "@/db";
import { users } from "@/db/schemas";
import { getReportingSummary } from "@/lib/queries/reporting";
import { sendTransactionalEmail } from "@/lib/services/email.service";
import { or, eq } from "drizzle-orm";

/** Weekly KPI digest emailed to admins. Fail-closed on the cron secret. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const summary = await getReportingSummary();
    const admins = await db
      .select({ email: users.email })
      .from(users)
      .where(or(eq(users.role, "admin"), eq(users.role, "super_admin")));

    const money = (n: number) =>
      n.toLocaleString(undefined, { style: "currency", currency: "USD" });

    const bodyLines = [
      `Revenue: ${money(summary.revenue)}`,
      `Cleaner payouts: ${money(summary.cleanerPayouts)}`,
      `Margin: ${money(summary.margin)}`,
      `Jobs — completed: ${summary.jobs.completed}, canceled: ${summary.jobs.canceled}, upcoming: ${summary.jobs.upcoming}`,
      `Coverage: ${summary.coverageRate}% · Dispute rate: ${summary.disputeRate}% · Late rate: ${summary.lateRate}%`,
      `Retention: ${summary.retentionRate}% · Active subs: ${summary.subscriptions.active}`,
    ];

    let sent = 0;
    for (const admin of admins) {
      if (!admin.email) continue;
      const res = await sendTransactionalEmail(
        admin.email,
        "CleanNami weekly summary",
        {
          previewText: "Your CleanNami weekly KPI summary.",
          heading: "Weekly summary",
          bodyLines,
          footnote: "Automated weekly digest.",
        }
      );
      if (res.success) sent += 1;
    }

    return new Response(JSON.stringify({ success: true, recipients: sent }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[cron/weekly-summary]", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
