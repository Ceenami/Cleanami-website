"use client";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  assignmentRoleLabel,
  assignmentSourceLabel,
  selectedAssignmentRole,
  type AssignmentAuditCandidate,
} from "@/lib/jobs/assignment-audit";
import type { ResidentialMargin } from "@/lib/pricing/residential-margin";
import type { EvidenceRoomStatus } from "@/lib/cleaner/upload-status";
type Operations = {
  residentialAllocations?: Array<{
    cleanerId: string;
    addonLead: boolean;
    baseHours: number;
    leadHours: number;
  }>;
  margin?: ResidentialMargin;
  evidenceRooms?: EvidenceRoomStatus[];
  runs: Array<{
    id: string;
    outcome: string;
    policyVersion: string;
    actorId: string | null;
    reason: string | null;
    createdAt: string;
    context?: Record<string, unknown> | null;
    candidates: AssignmentAuditCandidate[];
  }>;
  notes: Array<{ id: string; text: string; category: string }>;
  drafts: Array<{ cleanerId: string; explanations: Record<string, string> }>;
  cleanerNames: Record<string, string>;
  reissue: {
    eligible: boolean;
    expectedSnapshotHash: string;
    expectedPropertyRevision: number;
  };
};
type Coverage = {
  message: string;
  team: Array<{ cleanerId: string; name: string }> | null;
  candidates: Array<{
    cleanerId: string;
    name: string;
    source: string;
    reasons: string[];
    eligible: boolean;
  }>;
};
export function JobOperations({ jobId }: { jobId: string }) {
  const publicationId = useRef<string | null>(null);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [checkingCoverage, setCheckingCoverage] = useState(false);
  const [text, setText] = useState(""),
    [category, setCategory] = useState("note"),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [reason, setReason] = useState("");
  const { data, refetch, isError } = useQuery<Operations>({
    queryKey: ["job-operations", jobId],
    queryFn: async () => {
      const r = await fetch(`/api/admin/jobs/${jobId}/operations`);
      if (!r.ok) throw new Error("Operations history unavailable");
      return r.json();
    },
    refetchInterval: 30000,
  });
  async function checkCoverage() {
    setCheckingCoverage(true);
    setError("");
    try {
      const r = await fetch(`/api/admin/jobs/${jobId}/cover`);
      const result = await r.json();
      if (!r.ok) throw new Error(result.error ?? "Could not check coverage");
      setCoverage(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Coverage check failed");
    } finally {
      setCheckingCoverage(false);
    }
  }
  async function submit(reissue = false) {
    if (!publicationId.current) publicationId.current = crypto.randomUUID();
    setSaving(true);
    setError("");
    try {
      const r = await fetch(
        `/api/admin/jobs/${jobId}/${reissue ? "checklist/reissue" : "operations"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            reissue
              ? {
                  reason,
                  expectedSnapshotHash: data!.reissue.expectedSnapshotHash,
                  expectedPropertyRevision:
                    data!.reissue.expectedPropertyRevision,
                }
              : { text, category, publicationId: publicationId.current },
          ),
        },
      );
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setText("");
      publicationId.current = null;
      setReason("");
      await refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="border-t pt-6 space-y-4">
      <h2 className="text-lg font-semibold">
        Assignment decisions & customer report
      </h2>
      <button
        className="text-teal-800"
        disabled={checkingCoverage}
        onClick={checkCoverage}
      >
        {checkingCoverage
          ? "Checking coverage…"
          : "Suggest a qualified coverage team"}
      </button>
      {coverage && (
        <div
          className="border-l-2 border-teal-600 pl-3 space-y-2 text-sm"
          role="status"
        >
          <p>{coverage.message}</p>
          {coverage.team && (
            <p>
              Suggested full team: {coverage.team.map((c) => c.name).join(", ")}
            </p>
          )}
          <p className="text-gray-500">
            Read-only suggestion, not a claim or assignment. Use the assignment
            controls above; all checks run again.
          </p>
          <details>
            <summary>Candidate checks</summary>
            <ul>
              {coverage.candidates.map((c) => (
                <li key={c.cleanerId}>
                  {c.name} · {assignmentSourceLabel(c.source)} ·{" "}
                  {c.eligible ? "Eligible" : c.reasons.join(", ")}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
      {!data ? (
        <p>
          {isError ? "Operations history unavailable" : "Loading operations…"}
          <button onClick={() => refetch()} className="ml-3 text-teal-800">
            Retry
          </button>
        </p>
      ) : (
        <>
          {data.margin && (
            <div className="border-b pb-4 text-sm space-y-1">
              <h3 className="font-semibold">
                {data.margin.contribution
                  ? "Residential modeled contribution"
                  : "Residential labor-only margin"}
              </h3>
              {data.residentialAllocations?.map((a) => (
                <p key={a.cleanerId}>
                  {data.cleanerNames[a.cleanerId] ?? "Assigned cleaner"}:{" "}
                  {a.baseHours} base hours
                  {a.addonLead
                    ? `, designated add-on lead: ${a.leadHours} extra hours`
                    : ""}
                  .
                </p>
              ))}
              {data.margin.contribution && (
                <>
                  <p>
                    Quote model: $
                    {data.margin.contribution.quotedDollars.toFixed(2)} (
                    {data.margin.contribution.quotedPercent.toFixed(2)}%).
                  </p>
                  <p>
                    Current cost basis: {data.margin.basis.replaceAll("_", " ")}
                    . Modeled contribution:{" "}
                    {data.margin.contribution.modeledDollars === null
                      ? "Unavailable"
                      : `$${data.margin.contribution.modeledDollars.toFixed(2)}`}{" "}
                    {data.margin.contribution.modeledPercent === null
                      ? ""
                      : `(${data.margin.contribution.modeledPercent.toFixed(2)}%)`}
                    .
                  </p>
                  <p>
                    Floor result: {data.margin.contribution.floorStatus}
                    {data.margin.contribution.exception
                      ? ` / ${data.margin.contribution.exception}`
                      : ""}
                    .
                  </p>
                  <p className="text-xs text-gray-500">
                    Supplies, processing, operations and quality allowance are
                    model assumptions. This is not net profit or observed cash
                    spend. Unrecorded partial refunds are excluded. The quality
                    allowance is separate from the platform reserve hold.
                  </p>
                </>
              )}
              <p>
                Booked revenue:{" "}
                {(data.margin.revenueCents / 100).toLocaleString("en-US", {
                  style: "currency",
                  currency: "USD",
                })}
              </p>
              <p>
                Issued staffing: {data.margin.teamSize} cleaner(s) ×{" "}
                {data.margin.hoursPerCleaner} hours
              </p>
              {data.margin.laborCents === null ? (
                <p>
                  Assignment cost unavailable:{" "}
                  {data.margin.basis.replaceAll("_", " ")}. Nominal labor
                  estimate: ${(data.margin.nominalLaborCents / 100).toFixed(2)};
                  nominal margin: $
                  {(data.margin.nominalMarginCents / 100).toFixed(2)}.
                </p>
              ) : (
                <>
                  <p>
                    Labor cost: ${(data.margin.laborCents / 100).toFixed(2)} ·{" "}
                    {data.margin.basis === "recorded_payouts"
                      ? "Recorded payouts"
                      : "Frozen worker rates and recorded adjustments"}
                  </p>
                  <p>
                    Labor-only margin: $
                    {(data.margin.marginCents! / 100).toFixed(2)}
                  </p>
                </>
              )}
              <p className="text-xs text-gray-500">
                Includes booked discounts/complimentary work and recorded full
                refunds. Excludes processing fees, tax and unrecorded partial
                refunds. No price or pay is changed.
              </p>
            </div>
          )}
          {!data.runs.length && (
            <p className="text-sm text-gray-500">
              Assignment reason not recorded. No historical explanation has been
              reconstructed.
            </p>
          )}
          {data.runs.map((run) => (
            <details key={run.id} className="border-b py-3">
              <summary>
                {run.outcome} · {run.reason ?? "Team selected"} ·{" "}
                {new Date(run.createdAt).toLocaleString("en-US", {
                  timeZone: "America/New_York",
                  timeZoneName: "short",
                })}
              </summary>
              <p className="text-xs text-gray-500 mt-2">
                Policy {run.policyVersion} · Actor{" "}
                {run.actorId ?? "Not recorded"}
              </p>
              <ul className="text-sm space-y-2 mt-3">
                {run.candidates.map((c) => (
                  <li key={c.cleanerId}>
                    {data.cleanerNames[c.cleanerId] ?? c.cleanerId} ·{" "}
                    {assignmentSourceLabel(c.source)} ·{" "}
                    {selectedAssignmentRole(run, c)
                      ? selectedAssignmentRole(run, c) === "unknown"
                        ? "Assigned — role not recorded"
                        : `Assigned: ${assignmentRoleLabel(selectedAssignmentRole(run, c)!)}`
                      : c.reasons.join(", ") || "Eligible, not selected"}
                  </li>
                ))}
              </ul>
            </details>
          ))}
          {!!data.evidenceRooms?.length && (
            <section className="border-b pb-4 space-y-3">
              <h3 className="font-semibold">Photo upload status</h3>
              <p className="text-xs text-gray-500">
                Drafts and received uploads do not replace final submission.
                Offline devices report retained failures when they reconnect;
                counts reflect the last server report.
              </p>
              {data.evidenceRooms.map((room) => (
                <div
                  key={room.roomKey}
                  className="text-sm border-l-2 border-gray-200 pl-3"
                >
                  <p className="font-medium">
                    {room.label} ·{" "}
                    {room.required
                      ? `${room.required} required minimum`
                      : "Optional"}
                  </p>
                  <p>
                    {room.submitted} submitted · {room.draft} in saved drafts ·{" "}
                    {room.received} uploads received
                  </p>
                  {room.submitted < room.required && (
                    <p className="text-amber-800">
                      Missing from submitted evidence:{" "}
                      {room.required - room.submitted}
                    </p>
                  )}
                  {!!room.pending && (
                    <p className="text-amber-800">
                      {room.pending} retained / awaiting attachment to saved
                      progress
                    </p>
                  )}
                  {!!room.failed && (
                    <p role="status" className="text-red-700">
                      {room.failed} failed upload(s) · Cleaner can retry
                    </p>
                  )}
                  {!!room.progressSaveFailed && (
                    <p className="text-red-700">
                      {room.progressSaveFailed} received photo(s) could not be
                      saved to progress · Retry required
                    </p>
                  )}
                  {room.explanations.map((note) => (
                    <p key={note.cleanerId} className="text-amber-800">
                      {data.cleanerNames[note.cleanerId] ?? "Cleaner"}:{" "}
                      {note.text} · Photo minimum remains required.
                    </p>
                  ))}
                </div>
              ))}
            </section>
          )}
          {!data.evidenceRooms?.length &&
            data.drafts.flatMap((d) =>
              Object.entries(d.explanations).map(([room, explanation]) => (
                <p
                  key={`${d.cleanerId}:${room}`}
                  className="text-sm text-amber-800"
                >
                  Missing {room}: {explanation} — does not waive photo minimums.
                </p>
              )),
            )}
          {data.notes.map((n) => (
            <p key={n.id} className="text-sm">
              Published {n.category}: {n.text}
            </p>
          ))}
          {data.reissue.eligible ? (
            <div className="border-b pb-4">
              <label className="block text-sm">
                Reason to reissue the published property checklist
                <input
                  className="block w-full border rounded p-2 mt-2"
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <button
                disabled={saving || reason.trim().length < 3}
                className="mt-2 text-teal-800"
                onClick={() => submit(true)}
              >
                Reissue this future job
              </button>
            </div>
          ) : (
            <p className="text-xs text-gray-500">
              Issued checklist retained. Reissue requires a future, unassigned,
              unpaid rental job with no evidence or coverage.
            </p>
          )}
        </>
      )}
      <label className="block text-sm">
        Report category
        <select
          className="block border rounded p-2"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="note">Note</option>
          <option value="issue">Issue</option>
          <option value="restocking">Restocking</option>
        </select>
      </label>
      <label className="block text-sm">
        Anonymous customer-visible note
        <textarea
          maxLength={1000}
          className="block w-full border rounded p-3 mt-2"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <p className="text-xs text-gray-500">
        Explicit publication only. Do not include cleaner identity, access
        instructions, pay or internal discussion.
      </p>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <button
        disabled={saving || !text.trim()}
        onClick={() => submit()}
        className="bg-teal-700 text-white rounded px-4 py-2"
      >
        {saving ? "Saving…" : "Publish to customer report"}
      </button>
    </section>
  );
}
