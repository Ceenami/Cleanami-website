"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Route } from "next";
import {
  ARRIVAL_WINDOWS,
  type ArrivalWindowKey,
} from "@/lib/scheduling/arrival-windows";
import {
  JOB_LABELS,
  SERVICE_TYPE_LABELS,
  type JobLabel,
  type ServiceType,
} from "@/lib/constants/service-type";

type PropertyOption = {
  id: string;
  address: string;
  serviceType: ServiceType | null;
  customer?: { name: string | null } | null;
};

/**
 * Create a job by hand, then hand straight over to the assignment UI.
 *
 * This form creates and does not assign, which is deliberate: the
 * one-job-per-cleaner-per-day rule, its override and the typed reason all live
 * on the job detail page's existing assignment flow. Navigating there on
 * success is what makes "create, then assign" feel like one action without
 * being one — and without a second copy of the conflict rule.
 */
export function CreateJobModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<PropertyOption[]>([]);
  const [propertyId, setPropertyId] = useState("");
  const [date, setDate] = useState("");
  const [arrivalWindow, setArrivalWindow] = useState<ArrivalWindowKey | "">("");
  const [jobLabel, setJobLabel] = useState<JobLabel | "">("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // There are more properties than a bare <select> can hold usably, so the
  // list is searched rather than enumerated.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ page: "1", limit: "20" });
        if (search.trim()) params.set("query", search.trim());
        const res = await fetch(`/api/properties?${params}`);
        if (!res.ok) return;
        const body = (await res.json()) as { data?: PropertyOption[] };
        if (!cancelled) setOptions(body.data ?? []);
      } catch {
        // A failed lookup leaves the previous list in place; the admin can
        // retype. Nothing here is worth an error banner of its own.
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [search, open]);

  const selected = useMemo(
    () => options.find((p) => p.id === propertyId) ?? null,
    [options, propertyId]
  );
  const isResidential = selected?.serviceType === "residential_one_time";

  if (!open) return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          propertyId,
          date,
          arrivalWindow: arrivalWindow || undefined,
          jobLabel: jobLabel || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const body = (await res.json()) as { jobId?: string; error?: string };
      if (!res.ok || !body.jobId) {
        setError(body.error ?? "Could not create the job.");
        return;
      }
      onClose();
      router.push(`/admin/job-oversight/${body.jobId}` as Route);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Create a job</h3>
            <p className="mt-1 text-sm text-gray-500">
              For a reclean, a correction, or any clean that did not come from a
              calendar or a booking. No charge is taken.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700" htmlFor="cj-search">
              Property
            </label>
            <input
              id="cj-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by address..."
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <select
              aria-label="Property"
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              required
              size={5}
              className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Select a property…</option>
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.address}
                  {p.customer?.name ? ` — ${p.customer.name}` : ""}
                </option>
              ))}
            </select>
            {selected && (
              <p className="mt-1 text-xs text-gray-500">
                {
                  SERVICE_TYPE_LABELS[
                    selected.serviceType ?? "vacation_rental_subscription"
                  ]
                }
                {/* The customer comes with the property. That is the whole of
                    the link the client asked for, and why no customer field
                    appears on this form. */}
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700" htmlFor="cj-date">
              Date
            </label>
            <input
              id="cj-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">
              {isResidential
                ? "The customer notice period does not apply here — this can be scheduled for today."
                : "Times come from the property's own check-out and check-in."}
            </p>
          </div>

          {isResidential && (
            <div>
              <label className="block text-sm font-medium text-gray-700" htmlFor="cj-window">
                Arrival window
              </label>
              <select
                id="cj-window"
                value={arrivalWindow}
                onChange={(e) =>
                  setArrivalWindow(e.target.value as ArrivalWindowKey | "")
                }
                required
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Choose a window…</option>
                {ARRIVAL_WINDOWS.map((w) => (
                  <option key={w.key} value={w.key}>
                    {w.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700" htmlFor="cj-label">
              Label (optional)
            </label>
            <select
              id="cj-label"
              value={jobLabel}
              onChange={(e) => setJobLabel(e.target.value as JobLabel | "")}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">No label</option>
              {(Object.keys(JOB_LABELS) as JobLabel[]).map((key) => (
                <option key={key} value={key}>
                  {JOB_LABELS[key]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700" htmlFor="cj-notes">
              Why (optional)
            </label>
            <textarea
              id="cj-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="e.g. Redo of the 12 Aug clean — customer reported the kitchen."
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">
              Goes on the job, where the cleaner and the office both read it.
            </p>
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !propertyId || !date}
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {submitting ? "Creating…" : "Create and assign"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
