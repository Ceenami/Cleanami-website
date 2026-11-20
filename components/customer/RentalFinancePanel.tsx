"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Elements } from "@stripe/react-stripe-js";
import { getStripe } from "@/lib/stripe/client";
import { CheckoutForm } from "@/components/customers/cta-booking-button/CheckoutForm";
import { FinancialOperationRecovery } from "@/components/dashbboard/admin/job-oversight/FinancialOperationRecovery";
import type { loadJobFinance } from "@/lib/services/payment/rental-finance-admin";
type Finance = Awaited<ReturnType<typeof loadJobFinance>>;
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
export function RentalFinancePanel({ jobId, admin = false }: { jobId: string; admin?: boolean }) {
  const endpoint = `/api/${admin ? "admin" : "customer"}/jobs/${jobId}/finance`;
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false), [secret, setSecret] = useState<string | null>(null), [reason, setReason] = useState("");
  const queries = useQueryClient();
  const { data, isError, refetch } = useQuery<Finance>({ queryKey: ["rental-finance", jobId, admin], queryFn: async () => {
    const response = await fetch(endpoint, { cache: "no-store" }); if (!response.ok) throw Error("Could not load financial status"); return response.json();
  } });
  async function act(action: string, expectedCents?: number) {
    setBusy(true); setError(null);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(admin ? { action, reason, requestId: crypto.randomUUID() } : { action, expectedCents }) });
      const result = await response.json(); if (!response.ok) throw Error(result.error ?? "Payment requires review");
      setSecret(result.clientSecret ?? null);
      await refetch(); await queries.invalidateQueries({ queryKey: ["prepayment"] }); await queries.invalidateQueries({ queryKey: ["customer-job-report", jobId] });
    } catch (err) { setError(err instanceof Error ? err.message : "Payment requires review"); await refetch(); }
    finally { setBusy(false); }
  }
  if (isError) return <p role="alert">Payment status could not be loaded. Refresh before taking another payment action.</p>;
  if (!data) return null;
  const fee = data.operations.find(op => op.kind === "late_fee");
  return <section className="rounded-lg border bg-white p-5 space-y-3">
    <h2 className="font-semibold">{data.statusLabel === "Late Canceled" ? "Late Canceled — payment" : "Clean payment and prepayment"}</h2>
    {data.prepayment && <p className="text-sm">Prepayment: {data.prepayment.status} · {money(data.prepayment.balanceCents)} remaining, {money(data.prepayment.reservedCents)} reserved.</p>}
    {data.totalCents !== null && <p className="text-sm">Completed-clean amount: {money(data.totalCents)} · Credit {data.creditState === "applied" ? "applied" : "reserved"}: {money(data.creditCents)}</p>}
    {data.cancellation === "late_customer" && <p className="text-sm">Separate late fee: {data.scheduledCents === null ? "Review required" : money(data.scheduledCents)}. Unused prepayment is preserved.</p>}
    {data.operations.map(op => <p key={op.id} className="text-sm">{op.kind.replaceAll("_", " ")}: {money(op.cents)} · {op.state.replaceAll("_", " ")}</p>)}
    {data.payouts.length > 0 && <p className="text-sm">Accepted working-cleaner pay: {data.payouts.map(p => `${money(p.cents)} ${p.status}`).join("; ")}. Pending pay does not mean bank receipt.</p>}
    {!admin && <div className="flex flex-wrap gap-3 text-sm">
      {data.supplementalCents !== null && data.supplementalCents > 0 && data.creditCents > 0 && !data.operations.some(op => op.kind === "clean_payment" && ["paid", "waived", "review"].includes(op.state)) && <button type="button" disabled={busy} onClick={() => void act("accept_topup", data.supplementalCents!)} className="rounded border px-3 py-2">Approve and pay {money(data.supplementalCents)} additional</button>}
      {data.cancellation === "late_customer" && data.scheduledCents !== null && (!fee || !["paid", "waived", "refunded", "review"].includes(fee.state)) && <button type="button" disabled={busy} onClick={() => void act("pay_fee", data.scheduledCents!)} className="rounded border px-3 py-2">Pay separate fee {money(data.scheduledCents)}</button>}
      <button type="button" disabled={busy} onClick={() => void act("reconcile")} className="underline">Refresh payment and settlement</button>
    </div>}
    {admin && <div className="space-y-2 border-t pt-3">
      <label className="block text-sm">Reason for financial action<textarea className="block w-full rounded border p-2" value={reason} minLength={10} maxLength={1000} onChange={event => setReason(event.target.value)} /></label>
      <div className="flex flex-wrap gap-2">{["retry_fee", "reconcile", "waive_fee", "waive_clean_balance", "refund_fee", "release_credit_hold"].map(action => <button key={action} type="button" disabled={busy || reason.trim().length < 10} onClick={() => void act(action)} className="rounded border px-3 py-2 text-sm">{action.replaceAll("_", " ")}</button>)}</div>
      {data.operations.filter(op => ["review", "unknown", "failed"].includes(op.state)).map(op => <FinancialOperationRecovery key={op.id} operationId={op.id} />)}
      {data.audit?.length ? <details><summary className="text-sm">Financial action history</summary><ul className="text-sm">{(data.audit as Array<{ identity: string; action: string; actor: string; reason: string }>).map(item => <li key={item.identity}>{item.action} · {item.actor} · {item.reason}</li>)}</ul></details> : null}
    </div>}
    {secret && !admin && <Elements stripe={getStripe()} options={{ clientSecret: secret }}><CheckoutForm onPaymentSuccess={() => { setSecret(null); void act("reconcile"); }} /></Elements>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>;
}
