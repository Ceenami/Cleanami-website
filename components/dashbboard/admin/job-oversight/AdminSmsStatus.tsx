"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
type Status = { configuration: { enabled: boolean; schemaReady: boolean; recipientConfigured: boolean; recipientLabel: string | null; senderConfigured: boolean; environment: string | null; recipientAllowed: boolean }; carrierBlocked: boolean;
  items: Array<{ identity: string; category: string; job_id: string | null; state: string; last_error: string | null; delivery_status: string | null; created_at: string }> };
export function AdminSmsStatus() {
  const { data, isError, refetch } = useQuery<Status>({ queryKey: ["admin-sms-status"], refetchInterval: 30000, queryFn: async () => {
    const response = await fetch("/api/admin/admin-sms", { cache: "no-store" }); if (!response.ok) throw Error("Admin SMS unavailable"); return response.json();
  } });
  if (isError) return <p role="alert" className="text-sm">Admin SMS status unavailable. <button type="button" className="underline" onClick={() => void refetch()}>Retry</button></p>;
  if (!data) return null;
  const config = data.configuration;
  const setup = !config.recipientConfigured ? "Waiting for the client number" : !config.enabled ? "Sending disabled" : !config.schemaReady ? "Waiting for schema setup" : !config.senderConfigured ? "Waiting for verified SMS sender" : !config.environment || !config.recipientAllowed ? "Environment or TEST recipient setup incomplete" : data.carrierBlocked ? "Recipient opted out — SMS blocked" : `Configured recipient ${config.recipientLabel}`;
  return <details className="rounded-lg border bg-white p-4 text-sm"><summary className="cursor-pointer font-medium">Admin SMS · {setup}</summary>
    <p className="my-3">Operational summaries mirror admin email events. Email remains independent. Provider acceptance is shown separately from delivery; failed or uncertain sends need review before another message is arranged.</p>
    {!config.recipientConfigured && <p>The recipient is configured by the owner after the client supplies their number.</p>}
    <ul className="mt-3 space-y-2">{data.items.map(item => <li key={item.identity}>{item.category.replaceAll("_", " ")} · Dispatch {item.state} · Delivery {item.delivery_status ?? "not confirmed"}{item.last_error ? ` · ${item.last_error}` : ""}{" "}{item.job_id && <Link href={`/admin/job-oversight/${item.job_id}`} className="underline">Review job</Link>}</li>)}</ul>
  </details>;
}
