export default async () => {
  if (process.env.RENTAL_FINANCE_WORKER_ENABLED !== "true") return new Response("Disabled");
  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.URL, secret = process.env.CRON_SECRET;
  if (!base || !secret) return new Response("Configuration missing", { status: 500 });
  const response = await fetch(`${base}/api/cron/rental-finance`, { headers: { Authorization: `Bearer ${secret}` } });
  return new Response(await response.text(), { status: response.status });
};
export const config = { schedule: "*/5 * * * *" };
