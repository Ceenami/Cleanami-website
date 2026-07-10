"use client";

import { useState } from "react";
import Link from "next/link";
import type { CleanerJobSummary } from "@/lib/queries/cleaner-jobs";
import { cn } from "@/lib/utils";

const roleStyles: Record<
  CleanerJobSummary["role"],
  { label: string; className: string }
> = {
  teamLeader: {
    label: "Team Leader",
    className: "bg-indigo-100 text-indigo-800 border-indigo-200",
  },
  laundryLead: {
    label: "Laundry Lead",
    className: "bg-amber-100 text-amber-900 border-amber-200",
  },
  primary: {
    label: "Primary",
    className: "bg-slate-100 text-slate-700 border-slate-200",
  },
  backup: {
    label: "Backup",
    className: "bg-slate-100 text-slate-600 border-slate-200",
  },
};

type JobCardProps = {
  job: CleanerJobSummary;
};

export function JobCard({ job }: JobCardProps) {
  const role = roleStyles[job.role];
  const [swapLoading, setSwapLoading] = useState(false);
  const [swapMessage, setSwapMessage] = useState<string | null>(null);
  const [swapError, setSwapError] = useState<string | null>(null);

  async function handleSwapRequest(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setSwapLoading(true);
    setSwapMessage(null);
    setSwapError(null);

    try {
      const response = await fetch(
        `/api/cleaner/jobs/${job.jobId}/swap-request`,
        { method: "POST" }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Swap request failed");
      }
      const names =
        data.eligibleCleanerNames?.length > 0
          ? ` ${data.eligibleCleanerNames.length} cleaner(s) could cover this swap if approved.`
          : "";
      setSwapMessage(`${data.message}${names}`);
    } catch (err) {
      setSwapError(err instanceof Error ? err.message : "Swap request failed");
    } finally {
      setSwapLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Link href={`/cleaner/jobs/${job.jobId}`} className="block">
        <article
          className={cn(
            "rounded-xl border bg-white p-4 shadow-sm transition-shadow hover:shadow-md",
            job.urgentBonus && "border-orange-300 ring-1 ring-orange-200"
          )}
        >
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-gray-900">
                {job.propertyAddress ?? "Address pending"}
              </h2>
              <span
                className={cn(
                  "mt-1 inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                  role.className
                )}
              >
                {role.label}
              </span>
            </div>
            {job.urgentBonus && (
              <span className="shrink-0 rounded-full bg-orange-500 px-2.5 py-1 text-xs font-bold text-white">
                +$10 Urgent
              </span>
            )}
          </div>

          <dl className="space-y-2 text-sm text-gray-600">
            <div className="flex justify-between gap-4">
              <dt className="font-medium text-gray-500">Arrival window</dt>
              <dd className="text-right text-gray-900">
                {job.arrivalWindow ?? "TBD"}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="font-medium text-gray-500">Must finish before</dt>
              <dd className="text-right text-gray-900">
                {job.mustFinishBefore ?? "TBD"}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="font-medium text-gray-500">Expected pay</dt>
              <dd className="text-right font-semibold text-gray-900">
                ${job.expectedPay.toFixed(2)}
              </dd>
            </div>
            {job.teammates.length > 0 && (
              <div>
                <dt className="font-medium text-gray-500">Teammates</dt>
                <dd className="mt-1 text-gray-900">
                  {job.teammates.map((t) => t.name).join(", ")}
                </dd>
              </div>
            )}
          </dl>
        </article>
      </Link>

      {job.canRequestSwap && (
        <button
          type="button"
          onClick={handleSwapRequest}
          disabled={swapLoading}
          className="w-full rounded-lg border border-gray-300 bg-white py-2 text-sm font-medium text-gray-700 hover:border-brand hover:text-brand disabled:opacity-50"
        >
          {swapLoading ? "Requesting…" : "Request Swap"}
        </button>
      )}

      {swapMessage && (
        <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
          {swapMessage}
        </p>
      )}
      {swapError && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {swapError}
        </p>
      )}
    </div>
  );
}
