// Process persisted assignment offers, deadline stages and reconfirmation every five minutes.
export default async () => {
  if (process.env.ASSIGNMENT_OFFERS_SCHEMA_READY !== "true") return new Response("Disabled");
  const secret = process.env.CRON_SECRET;
  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.URL;
  if (!secret || !base) return new Response("Configuration missing", { status: 500 });
  const response = await fetch(`${base}/api/cron/assignment-offers`, { headers: { Authorization: `Bearer ${secret}` } });
  return new Response(await response.text(), { status: response.status });
};
export const config = { schedule: "*/5 * * * *" };
