// Scheduled trigger for /api/cron/pre-authorize (cancellation detection, then
// pre-authorises tomorrow's jobs). Daily at 09:00 ET.
//
// Runs in the morning so a failed pre-authorisation still leaves a business day
// to reach the customer before the clean.

export default async () => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/pre-authorize] CRON_SECRET is not set — refusing to run.");
    return new Response("CRON_SECRET is not set", { status: 500 });
  }

  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.URL;
  if (!base) {
    console.error("[cron/pre-authorize] No site URL available — refusing to run.");
    return new Response("No site URL available", { status: 500 });
  }

  const response = await fetch(`${base}/api/cron/pre-authorize`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });

  const body = await response.text();
  if (!response.ok) {
    console.error(`[cron/pre-authorize] ${response.status}: ${body}`);
    return new Response(body, { status: 500 });
  }

  console.log(`[cron/pre-authorize] ok: ${body}`);
  return new Response(body, { status: 200 });
};

export const config = { schedule: "0 14 * * *" };
