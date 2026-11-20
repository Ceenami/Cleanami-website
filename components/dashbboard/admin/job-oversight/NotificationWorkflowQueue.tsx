"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
type Item = { identity: string; kind: string; job_id: string | null; subscription_id: string | null; state: string; created_at: string; delivery_status: string | null };
export function NotificationWorkflowQueue() {
  const { data, isError, refetch } = useQuery<{ enabled: boolean; items: Item[] }>({ queryKey: ["notification-follow-up"], refetchInterval: 30000,
    queryFn: async () => { const response = await fetch("/api/admin/notification-workflows", { cache: "no-store" }); if (!response.ok) throw Error("Could not load notification follow-up"); return response.json(); } });
  if (isError) return <p role="alert" className="text-sm">Notification follow-up unavailable. <button className="underline" onClick={() => refetch()}>Retry</button></p>;
  if (!data?.enabled || !data.items.length) return null;
  return <details className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
    <summary className="cursor-pointer font-medium">Notification follow-up ({data.items.length}{data.items.length === 100 ? "+" : ""})</summary>
    <p className="my-3">Review failed or uncertain sends before arranging another notification. A send accepted by the provider does not prove delivery.</p>
    <ul className="space-y-2">{data.items.map(item => <li key={item.identity}>
      {item.kind.replaceAll("_", " ")} · {item.delivery_status ?? item.state} · {new Date(item.created_at).toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "short" })}{" "}
      {item.job_id ? <Link className="underline" href={`/admin/job-oversight/${item.job_id}`}>Review job</Link> : item.subscription_id ? <Link className="underline" href="/admin/subscriptions">Review subscription</Link> : "Record no longer available"}
    </li>)}</ul>
  </details>;
}
