// Scheduled trigger for /api/cron/capture-awaiting (captures finished cleans
// left parked at `awaiting_capture`). Twice daily, 06:00 and 18:00 ET.
//
// The 06:00 run is the one that matters: it picks up whatever reconcile-jobs
// parked at 02:00 ET. The 18:00 run catches same-day evening completions.

export default async () => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/capture-awaiting] CRON_SECRET is not set — refusing to run.");
    return new Response("CRON_SECRET is not set", { status: 500 });
  }

  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.URL;
  if (!base) {
    console.error("[cron/capture-awaiting] No site URL available — refusing to run.");
    return new Response("No site URL available", { status: 500 });
  }

  const response = await fetch(`${base}/api/cron/capture-awaiting`, {
    method: "GET",
    headers: { Authorization: `Bearer ${secret}` },
  });

  const body = await response.text();
  if (!response.ok) {
    console.error(`[cron/capture-awaiting] ${response.status}: ${body}`);
    return new Response(body, { status: 500 });
  }

  console.log(`[cron/capture-awaiting] ok: ${body}`);
  return new Response(body, { status: 200 });
};

export const config = { schedule: "0 11,23 * * *" };
