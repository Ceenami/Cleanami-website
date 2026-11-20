"use client";
import { useRef, useState } from "react";
import { rentalReactivationEndDate } from "@/lib/subscriptions/rental-finance-policy";
export function ReactivateRentalSubscription({ subscriptionId, onCreated }: { subscriptionId: string; onCreated: () => void }) {
  const [startDate, setStartDate] = useState(""), [endDate, setEndDate] = useState(""), [durationMonths, setDuration] = useState(1), [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), requestId = useRef<string | null>(null);
  async function reactivate() {
    setBusy(true); setError(null); requestId.current ??= crypto.randomUUID();
    try {
      const response = await fetch(`/api/subscriptions/${subscriptionId}/reactivate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ startDate, endDate, durationMonths, reason, requestId: requestId.current }) });
      const result = await response.json(); if (!response.ok) throw Error(result.error ?? "Reactivation requires review"); onCreated();
    } catch (err) { setError(err instanceof Error ? err.message : "Reactivation requires review"); }
    finally { setBusy(false); }
  }
  return <details className="border-t pt-3"><summary className="text-sm font-medium">Arrange a new term using existing property credit</summary>
    <div className="mt-3 space-y-2 text-sm">
      <p>For enrolled prepaid-credit contracts only. Confirm the new service dates and term with the customer. No new first-clean purchase is taken.</p>
      <label className="block">Start date<input type="date" value={startDate} onChange={event => { requestId.current = null; setStartDate(event.target.value); setEndDate(event.target.value ? rentalReactivationEndDate(event.target.value, durationMonths) : ""); }} className="ml-2 rounded border p-1" /></label>
      <p>Selected end date: {endDate || "Choose start date and term"}</p>
      <label className="block">Term months<select value={durationMonths} onChange={event => { requestId.current = null; setDuration(Number(event.target.value)); setEndDate(startDate ? rentalReactivationEndDate(startDate, Number(event.target.value)) : ""); }} className="ml-2 rounded border p-1">{[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
      <label className="block">Agreed service/reason<textarea value={reason} maxLength={1000} onChange={event => { requestId.current = null; setReason(event.target.value); }} className="block w-full rounded border p-2" /></label>
      <button type="button" disabled={busy || !startDate || !endDate || reason.trim().length < 10} onClick={() => void reactivate()} className="rounded border px-3 py-2">{busy ? "Arranging term…" : "Create agreed new term"}</button>
      {error && <p role="alert" className="text-red-700">{error}</p>}
    </div>
  </details>;
}
