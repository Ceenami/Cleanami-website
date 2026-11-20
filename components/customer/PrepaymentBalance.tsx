"use client";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
type Balance = { id: string; fundedCents: number; availableCents: number; balanceCents: number; reservedCents: number; appliedCents: number; status: string; held: boolean; sourcePaymentId?: string; holdReason?: string | null };
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
export function PrepaymentBalance({ propertyId, admin = false }: { propertyId: string; admin?: boolean }) {
  const endpoint = `/api/properties/${propertyId}/prepayment`;
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [refund, setRefund] = useState<{ id: string; amount: string; reason: string } | null>(null);
  const requestId = useRef<string | null>(null);
  const { data, isError, refetch } = useQuery<Balance[]>({ queryKey: ["prepayment", propertyId], queryFn: async () => {
    const response = await fetch(endpoint, { cache: "no-store" }); if (!response.ok) throw Error("Could not load prepayment"); return response.json();
  } });
  async function submitRefund() {
    if (!refund) return;
    const cents = Math.round(Number(refund.amount) * 100);
    if (!Number.isSafeInteger(cents) || cents <= 0 || refund.reason.trim().length < 10) { setError("Enter a valid amount and a reason of at least 10 characters."); return; }
    setBusy(true); setError(null); requestId.current ??= crypto.randomUUID();
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entitlementId: refund.id, cents, reason: refund.reason, requestId: requestId.current }) });
      const result = await response.json(); if (!response.ok) throw Error(result.error ?? "Refund requires review");
      await refetch();
      if (result.state === "refunded") { setRefund(null); requestId.current = null; }
      else setError(`Refund status: ${result.state}. Retain this request and reconcile before starting another refund.`);
    } catch (err) { setError(err instanceof Error ? err.message : "Refund requires review"); }
    finally { setBusy(false); }
  }
  if (isError) return <p role="alert">Prepayment could not be loaded. Refresh to check its status.</p>;
  if (!data?.length) return null;
  return <section className="rounded-lg border bg-white p-5 space-y-3">
    <h2 className="font-semibold">First-clean prepayment</h2>
    {data.map(balance => <div key={balance.id} className="space-y-1 text-sm">
      <p className="font-medium">{balance.status} · {money(balance.balanceCents)} remaining</p>
      <p>Available {money(balance.availableCents)} · Reserved {money(balance.reservedCents)} · Applied {money(balance.appliedCents)}</p>
      {balance.held && <p role="status">This prepayment needs management review before it can be used.</p>}
      {admin && balance.sourcePaymentId && <p className="break-all">Source payment: {balance.sourcePaymentId}{balance.holdReason ? ` · ${balance.holdReason}` : ""}</p>}
      {admin && balance.balanceCents > 0 && <button type="button" className="underline" disabled={busy} onClick={() => { requestId.current = null; setRefund({ id: balance.id, amount: (balance.balanceCents / 100).toFixed(2), reason: "" }); }}>Review approved refund</button>}
    </div>)}
    <p className="text-sm text-gray-600">Unused credit belongs to this customer and property. It survives a timely cancellation, reschedule or subscription end. Late-cancellation fees are separate.</p>
    {refund && <div className="space-y-2 border-t pt-3">
      <label className="block text-sm">Approved refund amount ($)<input type="number" min="0.01" step="0.01" value={refund.amount} disabled={busy || !!requestId.current} onChange={event => setRefund({ ...refund, amount: event.target.value })} className="block rounded border p-2" /></label>
      <label className="block text-sm">Reason<textarea value={refund.reason} minLength={10} maxLength={1000} disabled={busy || !!requestId.current} onChange={event => setRefund({ ...refund, reason: event.target.value })} className="block w-full rounded border p-2" /></label>
      <button type="button" disabled={busy} onClick={() => void submitRefund()} className="rounded border px-3 py-2">{busy ? "Checking refund…" : requestId.current ? "Reconcile same refund" : "Issue approved refund"}</button>
      {!requestId.current && <button type="button" onClick={() => setRefund(null)} className="ml-3 underline">Close</button>}
    </div>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>;
}
