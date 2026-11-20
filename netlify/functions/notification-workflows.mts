export default async () => {
  if (process.env.NOTIFICATION_WORKFLOWS_ENABLED !== "true" && process.env.ADMIN_SMS_ENABLED !== "true") return new Response("Disabled");
  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.URL;
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) return new Response("Configuration missing", { status: 500 });
  const response = await fetch(`${base}/api/cron/notification-workflows`, { headers: { Authorization: `Bearer ${secret}` } });
  return new Response(await response.text(), { status: response.status });
};
export const config = { schedule: "*/5 * * * *" };
