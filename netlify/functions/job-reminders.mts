// Scheduled trigger for /api/cron/job-reminders (spec §16.2 pre-arrival ETA
// prompt, ~1h before a clean). Runs every 15 minutes so a job's T-60 window is
// caught once; the route dedupes per job, so the exact cadence is not critical.

export default async () => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/job-reminders] CRON_SECRET is not set — refusing to run.");
    return new Response("CRON_SECRET is not set", { status: 500 });
  }

  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.URL;
  if (!base) {
    console.error("[cron/job-reminders] No site URL available — refusing to run.");
    return new Response("No site URL available", { status: 500 });
  }

  const response = await fetch(`${base}/api/cron/job-reminders`, {
    method: "GET",
    headers: { Authorization: `Bearer ${secret}` },
  });

  const body = await response.text();
  if (!response.ok) {
    console.error(`[cron/job-reminders] ${response.status}: ${body}`);
    return new Response(body, { status: 500 });
  }

  console.log(`[cron/job-reminders] ok: ${body}`);
  return new Response(body, { status: 200 });
};

export const config = { schedule: "*/15 * * * *" };
