// Poll the staged Sunday reminder endpoint. Eastern/DST timing and durable
// cleaner/period/stage deduplication are owned by the website service.

export default async () => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error(
      "[cron/availability-reminders] CRON_SECRET is not set — refusing to run.",
    );
    return new Response("CRON_SECRET is not set", { status: 500 });
  }

  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.URL;
  if (!base) {
    console.error(
      "[cron/availability-reminders] No site URL available — refusing to run.",
    );
    return new Response("No site URL available", { status: 500 });
  }

  const response = await fetch(`${base}/api/cron/availability-reminders`, {
    method: "GET",
    headers: { Authorization: `Bearer ${secret}` },
  });

  const body = await response.text();
  if (!response.ok) {
    console.error(`[cron/availability-reminders] ${response.status}: ${body}`);
    return new Response(body, { status: 500 });
  }

  console.log(`[cron/availability-reminders] ok: ${body}`);
  return new Response(body, { status: 200 });
};

// UTC polling; service gates to Sunday 09:00/17:00/18:00 Eastern, including DST.
export const config = { schedule: "*/15 * * * *" };
