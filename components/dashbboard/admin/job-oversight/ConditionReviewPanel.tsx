"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { loadConditionReview } from "@/lib/services/condition-review.service";
import { CONDITION_REVIEW_LABEL } from "@/lib/booking/condition-review";

export function ConditionReviewPanel({ jobId }: { jobId: string }) {
  const client = useQueryClient();
  const [reason, setReason] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const endpoint = `/api/admin/jobs/${jobId}/condition-review`;
  const { data, error } = useQuery<Awaited<ReturnType<typeof loadConditionReview>>>({
    queryKey: ["condition-review", jobId], queryFn: async () => {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (!response.ok) throw new Error("Condition review could not be loaded.");
      return response.json();
    },
  });
  async function act(action: "reviewed" | "reject") {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "reviewed" ? { action } : { action, reason: data?.rejection?.reason ?? reason, retryRefund: !!data?.rejection }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Action failed. Reload before retrying.");
      setMessage(result.message);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Action failed. Reload before retrying."); }
    finally {
      await client.invalidateQueries({ queryKey: ["condition-review", jobId] });
      await client.invalidateQueries({ queryKey: ["job-details", jobId] });
      await client.invalidateQueries({ queryKey: ["jobs"] });
      setBusy(false);
    }
  }
  if (error) return <p role="alert" className="p-4 text-red-700">Condition review could not be loaded. Reload before canceling this booking.</p>;
  if (!data) return null;
  const open = ["assigned", "unassigned"].includes(data.jobStatus ?? "");
  const settled = data.refund?.status === "refunded" || data.refund?.status === "no_charge";
  return <section className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-5">
    <h2 className="font-semibold text-amber-950">{CONDITION_REVIEW_LABEL}</h2>
    <p className="whitespace-pre-wrap text-sm text-gray-800">{data.description}</p>
    <p className="text-sm">{data.rejection ? "Rejected" : data.reviewed ? "Reviewed — booking continues" : "Needs management review"}</p>
    {data.rejection && <div className="space-y-2 text-sm">
      <p className="whitespace-pre-wrap">Reason: {data.rejection.reason}</p>
      <p>Refund: {String(data.refund?.status ?? "confirmation pending").replaceAll("_", " ")}. Customer cancellation penalty: $0.</p>
      {typeof data.refund?.refundedCents === "number" && <p>Successful refunds observed: ${(data.refund.refundedCents / 100).toFixed(2)}. Pending: ${(Number(data.refund.pendingCents ?? 0) / 100).toFixed(2)}.</p>}
      <p>Cleaner compensation requires separate review. Existing pay records are retained.</p>
      {data.notices.some(n => ["failed", "unknown", "skipped"].includes(n.status)) && <p role="alert">A notification attempt failed, was skipped or has an unknown outcome. Check notification logs before contacting the recipient manually.</p>}
    </div>}
    {open && <>
      {!data.reviewed && <button type="button" disabled={busy} onClick={() => act("reviewed")} className="rounded border border-gray-400 bg-white px-3 py-2 text-sm">Mark reviewed; keep booking</button>}
      <form onSubmit={e => { e.preventDefault(); void act("reject"); }} className="space-y-2">
        <label htmlFor="condition-rejection-reason" className="block text-sm font-medium">Reason sent to the customer</label>
        <textarea id="condition-rejection-reason" required maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} className="block w-full rounded border border-gray-300 px-3 py-2 text-sm" />
        <p className="text-sm">Rejecting cancels this booking and requests a full refund. This cannot be undone.</p>
        <button type="submit" disabled={busy || !reason.trim()} className="rounded bg-red-700 px-3 py-2 text-sm text-white">Reject booking and refund in full</button>
      </form>
    </>}
    {data.rejection && !settled && <button type="button" disabled={busy} onClick={() => act("reject")} className="rounded border border-gray-400 bg-white px-3 py-2 text-sm">Check / retry refund</button>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
