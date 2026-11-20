"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { checklistViewSchema, type ChecklistView } from "@/lib/checklists/view";

export function ChecklistContents({ checklist }: { checklist: ChecklistView }) {
  const sections = [...new Set(checklist.items.map(item => item.section || "Tasks"))];
  return <div className="mt-4 space-y-4">
    <p className="text-sm text-gray-600">{checklist.description}</p>
    {checklist.publicationNotice && <p role="status" className="text-sm text-amber-800">{checklist.publicationNotice}</p>}
    {checklist.revision !== null && <p className="text-xs text-gray-500">Published property revision {checklist.revision}</p>}
    {checklist.executionRevision > 0 && <p className="text-xs text-gray-500">Job checklist reissue {checklist.executionRevision}</p>}
    {checklist.completion && <p className="text-sm text-gray-700">Completion: {checklist.completion === "draft" ? "Draft progress — not submitted" : checklist.completion === "submitted" ? "Submitted record" : "Recorded progress"}</p>}
    {checklist.record === "missing" && <p role="status" className="text-sm text-amber-800">No checklist tasks or documents are recorded. Contact management.</p>}
    {sections.map(section => <div key={section}>
      <h3 className="mb-2 text-sm font-semibold text-gray-800">{section}</h3>
      <ul className="space-y-2 text-sm text-gray-800">{checklist.items.filter(item => (item.section || "Tasks") === section).map(item => <li key={item.id}>
        {checklist.scope === "job" && <span className={item.state === "completed" ? "text-teal-700" : "text-gray-500"}>{item.state === "completed" ? "Completed" : item.state === "not_completed" ? "Not completed" : "Not recorded"} — </span>}{item.task}
      </li>)}</ul>
    </div>)}
    {checklist.files.length > 0 && <div>
      <h3 className="mb-2 text-sm font-semibold text-gray-800">Checklist documents</h3>
      <ul className="space-y-2 text-sm">{checklist.files.map(file => <li key={file.id}>{file.url
        ? <a className="text-teal-700 underline break-words" href={file.url} target="_blank" rel="noopener noreferrer">{file.fileName} (opens in a new tab)</a>
        : <span className="text-amber-800">{file.fileName} — link unavailable. Refresh the links or contact management.</span>}</li>)}</ul>
    </div>}
  </div>;
}

export function ChecklistViewer({ endpoint, title = "Issued cleaning checklist", residential = false, wrapped = false }: {
  endpoint: string; title?: string; residential?: boolean; wrapped?: boolean;
}) {
  const [level, setLevel] = useState("standard");
  const url = residential ? `${endpoint}${endpoint.includes("?") ? "&" : "?"}level=${level}` : endpoint;
  const { data, isPending, isError, isFetching, refetch } = useQuery<ChecklistView>({
    queryKey: ["checklist-view", url], retry: false,
    queryFn: async () => {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error("Checklist could not be loaded");
      const body = await response.json();
      return checklistViewSchema.parse(wrapped ? body.checklist : body);
    },
  });
  return <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      {data && !isError && <span className={`rounded-full px-2 py-1 text-xs font-medium ${data.source === "missing" ? "bg-amber-100 text-amber-900" : "bg-teal-50 text-teal-800"}`}>{data.sourceLabel}</span>}
    </div>
    {residential && <label className="block text-sm text-gray-700">Company template preview
      <select className="ml-2 rounded border border-gray-300 px-2 py-1" value={level} onChange={event => setLevel(event.target.value)}>
        <option value="standard">Standard</option><option value="deep">Deep / Move-In / Move-Out</option>
      </select>
    </label>}
    {isPending && <p role="status" className="text-sm text-gray-600">Loading checklist…</p>}
    {isError ? <p role="alert" className="text-sm text-red-700">Error — checklist could not be loaded. Refresh or contact management.</p>
      : data && <details><summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-teal-700">View Checklist</summary><ChecklistContents checklist={data} /></details>}
    <button type="button" disabled={isFetching} onClick={() => refetch()} className="min-h-11 py-2 text-sm text-teal-700 underline disabled:opacity-50">{isFetching ? "Refreshing…" : isError ? "Retry loading checklist" : "Refresh checklist & document links"}</button>
  </section>;
}
