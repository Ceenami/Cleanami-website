"use client";

import { useCallback, useEffect, useState } from "react";
import type { AssignmentOffer } from "@/lib/services/assignment/offers.service";
import type { Reconfirmation, LifecycleAction } from "@/lib/services/assignment/lifecycle-policy";
import type { PriorityPlan } from "@/lib/services/assignment/priority-transitions";
import type { PriorityMoveApproval } from "@/lib/services/assignment/priority-approvals";

type Coverage = { offers: AssignmentOffer[]; canUpgradePolicy?:boolean;priorityMoves?:PriorityMoveApproval[];priorityWaiting?:boolean; priorityPlans?: Array<PriorityPlan & { incoming_approval?:PriorityMoveApproval|null;notices?: Array<{ state: string; dispatch_state: string; audience: string }> }>; reconfirmations?: Reconfirmation[]; actions?: LifecycleAction[]; lifecycleWarnings?: string[]; names?: Record<string, string>; label?: string; issues?: string[]; events?: Array<{ id: number; kind: string; occurred_at: string; offer_id: string }> };
export function AssignmentOffers({ jobId, admin = false, onChange }: { jobId: string; admin?: boolean; onChange?: () => void }) {
  const endpoint = `/api/${admin ? "admin" : "cleaner"}/jobs/${jobId}/offers`;
  const [data, setData] = useState<Coverage | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store" });
    if (!response.ok) throw new Error("Assignment responses could not be loaded.");
    setData(await response.json());
  }, [endpoint]);
  useEffect(() => {
    const refresh = () => load().catch(e => setError(e.message));
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => clearInterval(timer);
  }, [load]);
  async function act(body: unknown, destination = endpoint) {
    setBusy(true); setError("");
    try {
      const response = await fetch(destination, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not record response.");
      if (typeof result.destination === "string" && /^\/cleaner\/jobs\/[0-9a-f-]{36}$/.test(result.destination)) { window.location.assign(result.destination); return; }
      await load(); onChange?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not record response."); await load().catch(() => {}); }
    finally { setBusy(false); }
  }
  if (!data && !error) return null;
  const current = data?.offers.filter(o => o.state !== "revoked") ?? [];
  const timestamp = (value: string | null) => value ? new Date(value).toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "short" }) : "";
  return <section className="rounded-xl border bg-white p-5 space-y-3" aria-label="Assignment responses">
    <h2 className="font-semibold">{admin ? data?.label ?? "Assignment coverage" : "Your assignment response"}</h2>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {data?.issues?.map(issue => <p key={issue} className="text-sm text-amber-800">{issue}</p>)}
    {admin && data?.lifecycleWarnings?.map(warning => <p key={warning} className="text-sm text-amber-800">{warning}</p>)}
    {admin && data?.canUpgradePolicy && <div className="text-sm space-y-2"><p>Apply current response deadlines to this future job. Offers missing deadlines will be reissued; existing deadlines, accepted roles and pay stay recorded.</p><button disabled={busy} className="rounded border px-3 py-2" onClick={()=>act({action:"upgrade_future_policy"})}>Apply current confirmation rules</button></div>}
    {!admin && data?.priorityWaiting && <p className="text-sm">Your proposed working role is confirmed. Keep your current standby duty until the priority move is finalized.</p>}
    {!admin && data?.priorityMoves?.filter(move=>move.state!=="revoked").map(move=><div key={move.plan_id} className="border-t pt-3 text-sm space-y-2">
      <p><strong>Proposed main-property move</strong> · {move.state}</p>
      <p>{move.details.address} · {timestamp(move.details.plannedStart)} · {move.details.role === "laundry_lead" ? "Laundry Lead" : "Working cleaner"} · ${(move.details.rateCents/100).toFixed(2)}/hour</p>
      <p>Your current assignment stays in place until the move and its replacement are confirmed. Respond by {timestamp(move.response_due_at)}.</p>
      {move.state==="pending" && <div className="flex flex-wrap gap-3"><button disabled={busy} className="rounded bg-blue-700 px-3 py-2 text-white disabled:opacity-50" onClick={()=>act({action:"priority_move",planId:move.plan_id,targetScheduleVersion:move.target_schedule_version,response:"accepted"})}>Confirm proposed working duty</button><button disabled={busy} className="rounded border px-3 py-2 disabled:opacity-50" onClick={()=>act({action:"priority_move",planId:move.plan_id,targetScheduleVersion:move.target_schedule_version,response:"declined"})}>Cannot Fulfill</button></div>}
    </div>)}
    {admin && data?.priorityPlans?.map(plan => <div key={plan.id} className="border-t pt-3 text-sm space-y-2">
      <p><strong>Property priority move</strong> · {plan.state} · Requested {timestamp(plan.created_at)}{plan.resolved_at && ` · Resolved ${timestamp(plan.resolved_at)}`}</p>
      <p><a className="underline" href={`/admin/job-oversight/${plan.donor_job_id}`}>Current donor job</a> → <a className="underline" href={`/admin/job-oversight/${plan.target_job_id}`}>Priority property job</a></p>
      <p>{plan.state === "pending" ? plan.incoming_approval ? "Both current teams stay assigned while the proposed duties are confirmed." : "The donor worker remains assigned while the replacement considers a fresh working offer. The priority job is not covered yet." : plan.reason?.replaceAll("_", " ") ?? "Replacement accepted; review fresh job confirmations and paired backup coverage."}</p>
      {plan.incoming_approval && <p>Incoming main cleaner: {plan.incoming_approval.state} · Respond by {timestamp(plan.incoming_approval.response_due_at)}. Existing target coverage stays assigned until both proposed duties are confirmed.</p>}
      {plan.notices?.some(n => ["claimed", "failed"].includes(n.dispatch_state)) && <p className="text-amber-800">Priority notification dispatch needs review.</p>}
      {plan.state === "pending" && <button disabled={busy} className="rounded border px-3 py-2" onClick={() => act({ action: "cancel_priority", planId: plan.id })}>Stop priority move and retain donor worker</button>}
    </div>)}
    {current.map(offer => <div key={offer.id} className="border-t pt-3 text-sm space-y-2">
      {admin && <p>{data?.names?.[offer.cleaner_id] ?? "Cleaner"}{offer.paired_worker_id ? ` · Backup for ${data?.names?.[offer.paired_worker_id] ?? "working cleaner"}` : ""}</p>}
      <p><strong>{offer.role === "backup" ? "Backup duty" : offer.role === "laundry_lead" ? "Working cleaner · Laundry Lead" : "Working cleaner"}</strong> · Version {offer.version} · {offer.state}</p>
      {offer.role === "backup" && <p>Standby is unpaid. Moving to a working role requires a separate confirmation.</p>}
      <p className="text-slate-600">Offered {timestamp(offer.offered_at)}{offer.responded_at && ` · Responded ${timestamp(offer.responded_at)}`}{admin && ` · Notification dispatch: ${offer.dispatch_state}`}</p>
      {offer.state === "pending" && offer.response_due_at && <p>Respond by {timestamp(offer.response_due_at)}{+new Date(offer.response_due_at) <= Date.now() ? " · Response overdue" : ""}</p>}
      {offer.state === "pending" && offer.deadline_gate && <p>Admin will confirm the response timing for this assignment.</p>}
      {!admin && offer.state === "pending" && <div className="flex flex-wrap gap-3">
        <button disabled={busy} className="rounded bg-blue-700 px-3 py-2 text-white disabled:opacity-50" onClick={() => act({ offerId: offer.id, version: offer.version, scheduleVersion: offer.schedule_version, role: offer.role, response: "accepted" })}>{offer.role === "backup" ? "Confirm Backup" : "Confirm"}</button>
        <button disabled={busy} className="rounded border px-3 py-2 disabled:opacity-50" onClick={() => act({ offerId: offer.id, version: offer.version, scheduleVersion: offer.schedule_version, role: offer.role, response: "declined" })}>{offer.role === "backup" ? "Cannot Be Backup" : "Cannot Fulfill"}</button>
      </div>}
      {offer.state === "accepted" && data?.reconfirmations?.filter(r => r.offer_id === offer.id && r.state !== "revoked").map(record => <div key={record.id} className="space-y-2">
        <p>Pre-clean reconfirmation: {record.state === "cannot_fulfill" ? "Cannot fulfil · admin review requested" : record.state}</p>
        {!admin && record.state === "pending" && <div className="flex flex-wrap gap-3">
          <button disabled={busy} className="rounded bg-blue-700 px-3 py-2 text-white disabled:opacity-50" onClick={() => act({ reconfirmationId: record.id, offerId: offer.id, version: offer.version, scheduleVersion: offer.schedule_version, role: offer.role, response: "confirmed" }, `/api/cleaner/jobs/${jobId}/reconfirmation`)}>Reconfirm {offer.role === "backup" ? "backup duty" : "working duty"}</button>
          <button disabled={busy} className="rounded border px-3 py-2 disabled:opacity-50" onClick={() => act({ reconfirmationId: record.id, offerId: offer.id, version: offer.version, scheduleVersion: offer.schedule_version, role: offer.role, response: "cannot_fulfill" }, `/api/cleaner/jobs/${jobId}/reconfirmation`)}>{offer.role === "backup" ? "Cannot Be Backup" : "Cannot Fulfill"}</button>
        </div>}
      </div>)}
      {admin && offer.state === "accepted" && offer.role !== "backup" && <button disabled={busy} className="rounded border px-3 py-2" onClick={() => act({ action: "offer_promotion", workerId: offer.cleaner_id })}>Offer working role to paired backup</button>}
    </div>)}
    {admin && <div className="flex flex-wrap gap-3"><button disabled={busy} className="rounded border px-3 py-2 text-sm" onClick={() => act({ action: "repair_backups" })}>Find qualified missing backups</button><button disabled={busy} className="rounded border px-3 py-2 text-sm" onClick={() => act({ action: "plan_priority" })}>Check property priority replacement</button></div>}
    {admin && !!data?.actions?.length && <details className="text-sm"><summary>Reminders and escalations</summary><ol className="mt-2 space-y-1">{data.actions.map(action => <li key={action.id}>Version {data.offers.find(o => o.id === action.offer_id)?.version} · {action.kind.replaceAll("_", " ")} · {timestamp(action.occurred_at)} · Dispatch: {action.dispatch_state}</li>)}</ol></details>}
    {!!data?.offers.length && <details className="text-sm"><summary className="cursor-pointer">Assignment history</summary><ol className="mt-2 space-y-2">{data.offers.map(offer => <li key={offer.id}>{admin ? `${data.names?.[offer.cleaner_id] ?? "Cleaner"} · ` : ""}Version {offer.version} · {offer.role === "backup" ? "Backup" : "Working"} · {offer.state} · {timestamp(offer.revoked_at ?? offer.responded_at ?? offer.offered_at)}{offer.reason ? ` · ${offer.reason.replaceAll("_", " ")}` : ""}</li>)}</ol>{admin && <ol className="mt-3 space-y-1">{data.events?.map(event => <li key={event.id}>Version {data.offers.find(o => o.id === event.offer_id)?.version} · {event.kind} · {timestamp(event.occurred_at)}</li>)}</ol>}</details>}
  </section>;
}
