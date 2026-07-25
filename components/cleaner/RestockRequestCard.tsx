"use client";

import { useState } from "react";
import { PackagePlus, Check } from "lucide-react";

const URGENCIES = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "urgent", label: "Urgent" },
] as const;

/**
 * Cleaner-raised supply request from a job (task 1.16).
 *
 * Free by design — there is no price here and nothing the cleaner submits
 * reaches a charge. It files a request for an admin to action.
 */
export function RestockRequestCard({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false);
  const [item, setItem] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [urgency, setUrgency] = useState<"low" | "normal" | "urgent">("normal");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const reset = () => {
    setItem("");
    setQuantity("1");
    setUrgency("normal");
    setNotes("");
    setError(null);
  };

  async function submit() {
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/cleaner/jobs/${jobId}/restock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item: item.trim(),
          quantity: Number(quantity) || 1,
          urgency,
          notes: notes.trim() || undefined,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Could not send that request.");
      }

      setSubmitted(true);
      setOpen(false);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send that request.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <div className="rounded-xl border bg-white p-4">
        {submitted && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
            <Check className="h-4 w-4 shrink-0" />
            Restock request sent — the office has been notified.
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            setSubmitted(false);
            setOpen(true);
          }}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
        >
          <PackagePlus className="h-4 w-4" />
          {submitted ? "Request something else" : "Request a restock"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border bg-white p-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">
          Request a restock
        </h3>
        <p className="mt-0.5 text-xs text-gray-500">
          Tell the office what this property is running low on. There is no
          charge to you or the customer.
        </p>
      </div>

      <label className="block">
        <span className="text-xs font-medium text-gray-600">Item</span>
        <input
          type="text"
          value={item}
          onChange={(e) => setItem(e.target.value)}
          placeholder="Toilet paper"
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-gray-600">Quantity</span>
          <input
            type="number"
            min={1}
            max={999}
            step={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-gray-600">Urgency</span>
          <select
            value={urgency}
            onChange={(e) =>
              setUrgency(e.target.value as "low" | "normal" | "urgent")
            }
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          >
            {URGENCIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="text-xs font-medium text-gray-600">
          Notes <span className="text-gray-400">(optional)</span>
        </span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Down to the last roll in the main bathroom"
          className="mt-1 w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
        />
      </label>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting || item.trim().length < 2}
          className="flex-1 rounded-lg bg-brand py-2.5 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
        >
          {submitting ? "Sending…" : "Send request"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            reset();
          }}
          disabled={submitting}
          className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
