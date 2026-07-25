// Scheduled trigger for /api/cron/process-payout (Stripe Connect transfers for
// pending payouts). Daily at 10:00 ET.
//
// Deliberately after capture-awaiting (06:00 ET) so a clean captured overnight
// pays out the same morning rather than waiting a further day.

export default async () => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/process-payout] CRON_SECRET is not set — refusing to run.");
    return new Response("CRON_SECRET is not set", { status: 500 });
  }

  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.URL;
  if (!base) {
    console.error("[cron/process-payout] No site URL available — refusing to run.");
    return new Response("No site URL available", { status: 500 });
  }

  const response = await fetch(`${base}/api/cron/process-payout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });

  const body = await response.text();
  if (!response.ok) {
    console.error(`[cron/process-payout] ${response.status}: ${body}`);
    return new Response(body, { status: 500 });
  }

  console.log(`[cron/process-payout] ok: ${body}`);
  return new Response(body, { status: 200 });
};

export const config = { schedule: "0 15 * * *" };
