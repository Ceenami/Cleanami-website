"use client";
import { useQuery } from "@tanstack/react-query";
import { FinancialOperationRecovery } from "./FinancialOperationRecovery";
type Queue = { operations: Array<{ id: string; job_id: string | null; kind: string; cents: number; state: string }>;
  heldCredit: Array<{ id: string; property_id: string; hold_reason: string | null }>;
  missingFees: Array<{ job_id: string; cents: number }>;
  notices: Array<{ identity: string; job_id: string | null; subject: string; state: string }> };
export function RentalFinancialQueue() {
  const { data, isError } = useQuery<Queue>({ queryKey: ["rental-financial-attention"], queryFn: async () => { const response = await fetch("/api/admin/rental-finance", { cache: "no-store" }); if (!response.ok) throw Error("Financial attention unavailable"); return response.json(); } });
  if (isError) return <p role="alert">Financial follow-up could not be loaded.</p>;
  if (!data || ![...data.operations, ...data.heldCredit, ...data.missingFees, ...data.notices].length) return null;
  return <details className="rounded-lg border bg-white p-4"><summary className="font-semibold">Financial follow-up · {data.operations.length + data.heldCredit.length + data.missingFees.length + data.notices.length}</summary>
    <ul className="mt-3 space-y-2 text-sm">
      {data.operations.map(op => <li key={op.id}>{op.job_id ? <a className="underline" href={`/admin/job-oversight/${op.job_id}`}>Job {op.job_id.slice(0, 8)}</a> : "Prepayment refund"} · {op.kind.replaceAll("_", " ")} · ${(op.cents / 100).toFixed(2)} · {op.state.replaceAll("_", " ")}<FinancialOperationRecovery operationId={op.id} /></li>)}
      {data.missingFees.map(item => <li key={item.job_id}><a className="underline" href={`/admin/job-oversight/${item.job_id}`}>Job {item.job_id.slice(0, 8)}</a> · Fee due ${(item.cents / 100).toFixed(2)}; collection not initialized</li>)}
      {data.heldCredit.map(item => <li key={item.id}><a className="underline" href={`/admin/properties/${item.property_id}`}>Property prepayment</a> · Held: {item.hold_reason}</li>)}
      {data.notices.map(item => <li key={item.identity}>{item.subject} · {item.state}; inspect channel logs before resending</li>)}
    </ul>
  </details>;
}
