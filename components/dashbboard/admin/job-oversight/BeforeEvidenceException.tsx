"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
export function BeforeEvidenceException({ jobId }: { jobId: string }) {
  const queryClient = useQueryClient(), [reason, setReason] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const url = `/api/admin/jobs/${jobId}/before-evidence`;
  const { data, isError } = useQuery<{ startedAt: string | null; exception: boolean; exceptionReason: string | null; missing: string[] } | null>({ queryKey: ["before-requirements", jobId], queryFn: async () => {
    const response = await fetch(url, { cache: "no-store" }); if (!response.ok) throw Error("Before evidence status unavailable"); return response.json();
  } });
  if (isError) return <p role="alert" className="text-sm text-red-700">Before evidence status unavailable. Refresh before making an exception.</p>;
  if (!data) return null;
  async function save() {
    setBusy(true); setError("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
      const result = await response.json(); if (!response.ok) throw Error(result.error || "Could not save exception");
      await queryClient.invalidateQueries({ queryKey: ["before-requirements", jobId] });
    } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  }
  return <section className="rounded-lg border border-gray-200 p-4 space-y-3">
    <h3 className="font-semibold">Required Before photos</h3>
    <p className="text-sm">{data.startedAt ? "Cleaning start recorded; arrival evidence is locked." : data.exception ? `Admin exception: ${data.exceptionReason}` : data.missing.length ? `Missing: ${data.missing.join(", ")}` : "Room requirements met. Cleaner can start after pending uploads finish."}</p>
    {!data.startedAt && !data.exception && <>
      <label htmlFor={`before-exception-${jobId}`} className="block text-sm font-medium">Reason for allowing cleaning without required Before photos</label>
      <textarea id={`before-exception-${jobId}`} value={reason} onChange={event => setReason(event.target.value)} minLength={10} maxLength={1000} className="w-full rounded border p-2" />
      <button type="button" disabled={busy || reason.trim().length < 10} onClick={() => void save()} className="rounded border px-3 py-2 text-sm disabled:opacity-50">{busy ? "Saving…" : "Record admin exception"}</button>
    </>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>;
}
