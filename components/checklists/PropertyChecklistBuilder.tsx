"use client";
import { useEffect, useState } from "react";
import type { ChecklistDraft } from "@/lib/checklists/rental-library";
type State = {
  revision: number;
  status: string;
  publishedRevision: number;
  draft: ChecklistDraft;
  library: Array<{
    id: string;
    task: string;
    section?: string;
    mandatory: boolean;
  }>;
};
export function PropertyChecklistBuilder({
  propertyId,
  admin,
}: {
  propertyId: string;
  admin: boolean;
}) {
  const [state, setState] = useState<State | null>(null),
    [draft, setDraft] = useState<ChecklistDraft | null>(null);
  const [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [task, setTask] = useState(""),
    [reason, setReason] = useState("");
  const url = `/api/properties/${propertyId}/structured-checklist${admin ? "" : "?ownerScope=1"}`;
  async function load() {
    const response = await fetch(url);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    setState(body);
    setDraft(body.draft);
  }
  useEffect(() => {
    setState(null);
    setDraft(null);
    setError("");
    load().catch((e) => setError(e.message));
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save(action?: "approve" | "reject", outOfScope = false) {
    if (!draft || !state) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft,
          expectedRevision: state.revision,
          ...(action
            ? {
                review: {
                  action,
                  reason: outOfScope ? `[Out of scope] ${reason}` : reason,
                },
              }
            : {}),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }
  if (!state || !draft)
    return (
      <section>
        <h2 className="text-lg font-semibold">Rental checklist</h2>
        <p role="status">{error || "Loading checklist…"}</p>
        {error && (
          <button
            className="text-teal-800 mt-2"
            onClick={() => {
              setError("");
              load().catch((e) => setError(e.message));
            }}
          >
            Retry loading checklist
          </button>
        )}
      </section>
    );
  const sections = [...new Set(state.library.map((t) => t.section ?? "Tasks"))];
  const dirty = JSON.stringify(draft) !== JSON.stringify(state.draft);
  return (
    <section className="border-t pt-6 space-y-4">
      <header>
        <h2 className="text-lg font-semibold">Rental checklist</h2>
        <p className="text-sm text-gray-600">
          {state.status} · Published revision {state.publishedRevision}. Changes
          affect newly issued jobs only.
        </p>
      </header>
      {dirty && (
        <p role="status" className="text-sm text-amber-800">
          Unsaved changes. Save before reviewing this revision.
        </p>
      )}
      {state.status === "pending" && (
        <p role="status" className="text-sm">
          Custom tasks await admin review. The last published checklist remains
          active.
        </p>
      )}
      {sections.map((section) => (
        <fieldset key={section} className="space-y-2">
          <legend className="font-medium mb-2">{section}</legend>
          {state.library
            .filter((t) => (t.section ?? "Tasks") === section)
            .map((t) => (
              <label key={t.id} className="flex gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={draft.libraryIds.includes(t.id)}
                  disabled={saving || t.mandatory}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      libraryIds: e.target.checked
                        ? [...draft.libraryIds, t.id]
                        : draft.libraryIds.filter((id) => id !== t.id),
                    })
                  }
                />
                <span>
                  {t.task}
                  {t.mandatory && (
                    <span className="text-gray-500"> · Company essential</span>
                  )}
                </span>
              </label>
            ))}
        </fieldset>
      ))}
      <h3 className="font-medium">Custom tasks — admin approval required</h3>
      {draft.customTasks.map((t) => (
        <div key={t.id} className="flex justify-between gap-3 text-sm">
          <input
            aria-label="Custom task text"
            className="border rounded p-2 flex-1 min-w-0"
            maxLength={300}
            value={t.task}
            disabled={saving}
            onChange={(e) =>
              setDraft({
                ...draft,
                customTasks: draft.customTasks.map((c) =>
                  c.id === t.id ? { ...c, task: e.target.value } : c,
                ),
              })
            }
          />
          <button
            disabled={saving}
            onClick={() =>
              setDraft({
                ...draft,
                customTasks: draft.customTasks.filter((c) => c.id !== t.id),
              })
            }
          >
            Remove
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <input
          aria-label="New custom task"
          maxLength={300}
          className="border rounded px-3 py-2 flex-1 min-w-0"
          value={task}
          onChange={(e) => setTask(e.target.value)}
        />
        <button
          disabled={
            saving || task.trim().length < 3 || draft.customTasks.length >= 40
          }
          onClick={() => {
            setDraft({
              ...draft,
              customTasks: [
                ...draft.customTasks,
                {
                  id: `custom-${crypto.randomUUID()}`,
                  task: task.trim(),
                  section: "Property-specific",
                },
              ],
            });
            setTask("");
          }}
        >
          Add task
        </button>
      </div>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <button
        className="bg-teal-700 text-white rounded px-4 py-2"
        disabled={saving}
        onClick={() => save()}
      >
        {saving ? "Saving…" : "Save checklist"}
      </button>
      {admin && state.status === "pending" && (
        <div className="border-t pt-4 space-y-2">
          <label className="block">
            Review reason
            <input
              className="block border rounded px-3 py-2 w-full"
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button
            disabled={saving || dirty || reason.trim().length < 3}
            onClick={() => save("approve")}
            className="mr-4 text-teal-800"
          >
            Approve revision
          </button>
          <button
            disabled={saving || dirty || reason.trim().length < 3}
            onClick={() => save("reject")}
          >
            Reject revision
          </button>
          <button
            disabled={saving || dirty || reason.trim().length < 3}
            className="ml-4 text-amber-800"
            onClick={() => save("reject", true)}
          >
            Reject as out of scope
          </button>
        </div>
      )}
    </section>
  );
}
