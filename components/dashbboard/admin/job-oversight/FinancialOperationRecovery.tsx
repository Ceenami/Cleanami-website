"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
export function FinancialOperationRecovery({ operationId }: { operationId: string }) {
  const [providerId, setProviderId] = useState(""), [reason, setReason] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const queries = useQueryClient();
  async function reconcile() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/admin/rental-finance/operations/${operationId}/reconcile`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerId, reason, requestId: crypto.randomUUID() }) });
      const result = await response.json(); if (!response.ok) throw Error(result.error ?? "Provider record requires review");
      setMessage(`Recorded outcome: ${result.state}`); await queries.invalidateQueries({ queryKey: ["rental-finance"] }); await queries.invalidateQueries({ queryKey: ["rental-financial-attention"] }); await queries.invalidateQueries({ queryKey: ["prepayment"] });
    } catch (err) { setMessage(err instanceof Error ? err.message : "Provider record requires review"); }
    finally { setBusy(false); }
  }
  return <details className="mt-2 text-sm"><summary>Reconcile a known provider record</summary><p>Use the matching Stripe payment/refund ID after reviewing its outcome. This checks the original operation and does not create another payment.</p>
    <p className="break-all text-xs">Recorded operation: {operationId}</p>
    <input aria-label="Stripe payment or refund ID" value={providerId} onChange={event => setProviderId(event.target.value)} placeholder="pi_… or re_…" className="my-2 block rounded border p-2" />
    <textarea aria-label="Reconciliation reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} className="block w-full rounded border p-2" />
    <button type="button" disabled={busy || reason.trim().length < 10 || !providerId} onClick={() => void reconcile()} className="mt-2 rounded border px-3 py-2">Verify and reconcile</button><p role="status">{message}</p>
  </details>;
}
