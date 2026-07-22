// Scheduled trigger for /api/cron/sync-calendars (guest-calendar iCal pull +
// job generation). Every 4 hours.
//
// Schedules across netlify/functions are fixed UTC tuned for EST (UTC-5); they
// run an hour later in ET during daylight time. Each job has enough slack in it
// that the drift does not matter — see the ordering note in reconcile-jobs.mts.

export default async () => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/sync-calendars] CRON_SECRET is not set — refusing to run.");
    return new Response("CRON_SECRET is not set", { status: 500 });
  }

  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.URL;
  if (!base) {
    console.error("[cron/sync-calendars] No site URL available — refusing to run.");
    return new Response("No site URL available", { status: 500 });
  }

  const response = await fetch(`${base}/api/cron/sync-calendars`, {
    method: "GET",
    headers: { Authorization: `Bearer ${secret}` },
  });

  const body = await response.text();
  if (!response.ok) {
    console.error(`[cron/sync-calendars] ${response.status}: ${body}`);
    return new Response(body, { status: 500 });
  }

  console.log(`[cron/sync-calendars] ok: ${body}`);
  return new Response(body, { status: 200 });
};

export const config = { schedule: "0 */4 * * *" };
