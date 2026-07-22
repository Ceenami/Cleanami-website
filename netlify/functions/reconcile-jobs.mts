// Scheduled trigger for /api/cron/reconcile-jobs (closes abandoned jobs and
// parks finished ones at `awaiting_capture`). Nightly at 02:00 ET.
//
// This is the "reconciled nightly" pass that 06-CleanNami-Phase-0-Summary.md
// describes to the customer. It runs first in the overnight chain: reconcile
// (02:00 ET) parks jobs -> capture-awaiting (06:00 ET) captures them ->
// process-payout (10:00 ET) pays the cleaner. Keep that ordering if you retime
// any of them.

export default async () => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/reconcile-jobs] CRON_SECRET is not set — refusing to run.");
    return new Response("CRON_SECRET is not set", { status: 500 });
  }

  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.URL;
  if (!base) {
    console.error("[cron/reconcile-jobs] No site URL available — refusing to run.");
    return new Response("No site URL available", { status: 500 });
  }

  const response = await fetch(`${base}/api/cron/reconcile-jobs`, {
    method: "GET",
    headers: { Authorization: `Bearer ${secret}` },
  });

  const body = await response.text();
  if (!response.ok) {
    console.error(`[cron/reconcile-jobs] ${response.status}: ${body}`);
    return new Response(body, { status: 500 });
  }

  console.log(`[cron/reconcile-jobs] ok: ${body}`);
  return new Response(body, { status: 200 });
};

export const config = { schedule: "0 7 * * *" };
