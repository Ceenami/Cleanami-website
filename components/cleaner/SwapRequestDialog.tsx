"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import type { CleanerJobSummary } from "@/lib/queries/cleaner-jobs";
import { cn } from "@/lib/utils";

const REASON_MAX_LENGTH = 500;

type SubmitResult = {
  jobId: string;
  success: boolean;
  message: string;
};

type SwapRequestDialogProps = {
  jobs: CleanerJobSummary[];
  /** Opens with this job already ticked, when raised from a job card. */
  preselectedJobId?: string | null;
  onClose: () => void;
  onSubmitted: () => void;
};

export function SwapRequestDialog({
  jobs,
  preselectedJobId,
  onClose,
  onSubmitted,
}: SwapRequestDialogProps) {
  const [selected, setSelected] = useState<string[]>(() =>
    preselectedJobId ? [preselectedJobId] : []
  );
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<SubmitResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const jobsById = useMemo(
    () => new Map(jobs.map((job) => [job.jobId, job])),
    [jobs]
  );
  const selectableCount = useMemo(
    () => jobs.filter((job) => job.canRequestSwap).length,
    [jobs]
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function toggle(jobId: string) {
    setResults(null);
    setSelected((prev) =>
      prev.includes(jobId)
        ? prev.filter((id) => id !== jobId)
        : [...prev, jobId]
    );
  }

  async function handleSubmit() {
    if (selected.length === 0) return;

    setSubmitting(true);
    setError(null);
    setResults(null);

    try {
      const response = await fetch("/api/cleaner/swap-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobIds: selected, reason: reason.trim() || null }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Swap request failed");
      }

      setResults(data.results ?? []);
      setSelected([]);
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Swap request failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="swap-dialog-title"
        className="relative flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div>
            <h2
              id="swap-dialog-title"
              className="text-lg font-semibold text-gray-900"
            >
              Request a swap
            </h2>
            <p className="mt-0.5 text-sm text-gray-500">
              Pick the cleans you need covered. Eligible cleaners are notified
              straight away and the first to accept takes over — you stay
              assigned until then.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {jobs.length === 0 ? (
            <p className="text-sm text-gray-500">
              You have no upcoming jobs to swap.
            </p>
          ) : (
            <ul className="space-y-2">
              {jobs.map((job) => {
                const disabled = !job.canRequestSwap;
                const checked = selected.includes(job.jobId);

                return (
                  <li key={job.jobId}>
                    <label
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
                        checked
                          ? "border-brand bg-brand/5"
                          : "border-gray-200 hover:border-gray-300",
                        disabled && "cursor-not-allowed opacity-60 hover:border-gray-200"
                      )}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 accent-teal-600"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggle(job.jobId)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-gray-900">
                          {job.propertyAddress ?? "Address pending"}
                        </span>
                        <span className="mt-0.5 block text-xs text-gray-600">
                          {job.arrivalWindow ?? "Time TBD"}
                        </span>
                        {disabled && job.swapBlockedReason && (
                          <span className="mt-1 block text-xs font-medium text-amber-700">
                            {job.swapBlockedReason}
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          {selectableCount > 0 && (
            <label className="block">
              <span className="text-sm font-medium text-gray-700">
                Reason (optional)
              </span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={REASON_MAX_LENGTH}
                rows={3}
                placeholder="e.g. Out of town that weekend"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <span className="mt-1 block text-xs text-gray-500">
                Shown to the cleaners offered the job, and to admins.
              </span>
            </label>
          )}

          {results && (
            <ul className="space-y-2">
              {results.map((result) => {
                const job = jobsById.get(result.jobId);
                return (
                  <li
                    key={result.jobId}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-xs",
                      result.success
                        ? "border-green-200 bg-green-50 text-green-800"
                        : "border-red-200 bg-red-50 text-red-700"
                    )}
                  >
                    <span className="font-semibold">
                      {job?.propertyAddress ?? "This job"}
                    </span>
                    {job?.arrivalWindow ? ` — ${job.arrivalWindow}` : ""}
                    <span className="mt-0.5 block">{result.message}</span>
                  </li>
                );
              })}
            </ul>
          )}

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {results ? "Done" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || selected.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting
              ? "Sending…"
              : selected.length > 1
                ? `Request ${selected.length} swaps`
                : "Request swap"}
          </button>
        </div>
      </div>
    </div>
  );
}
