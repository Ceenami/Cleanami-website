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
  /** Opens the swap picker with this job pre-selected. */
  onRequestSwap: (jobId: string) => void;
  onSwapWithdrawn: () => void;
};

export function JobCard({ job, onRequestSwap, onSwapWithdrawn }: JobCardProps) {
  const role = roleStyles[job.role];
  const [withdrawing, setWithdrawing] = useState(false);
  const [swapError, setSwapError] = useState<string | null>(null);

  async function handleWithdraw() {
    if (!job.pendingSwapRequestId) return;

    setWithdrawing(true);
    setSwapError(null);

    try {
      const response = await fetch(
        `/api/cleaner/swap-requests/${job.pendingSwapRequestId}`,
        { method: "DELETE" }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Could not withdraw the request");
      }
      onSwapWithdrawn();
    } catch (err) {
      setSwapError(
        err instanceof Error ? err.message : "Could not withdraw the request"
      );
    } finally {
      setWithdrawing(false);
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

      {job.pendingSwapRequestId ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs font-semibold text-amber-900">
            Swap open — waiting for a cleaner to accept
          </p>
          <p className="mt-0.5 text-xs text-amber-800">
            You stay assigned to this clean until someone takes it over.
          </p>
          <button
            type="button"
            onClick={handleWithdraw}
            disabled={withdrawing}
            className="mt-2 text-xs font-semibold text-amber-900 underline disabled:opacity-50"
          >
            {withdrawing ? "Withdrawing…" : "Withdraw request"}
          </button>
        </div>
      ) : job.canRequestSwap ? (
        <button
          type="button"
          onClick={() => onRequestSwap(job.jobId)}
          className="w-full rounded-lg border border-gray-300 bg-white py-2 text-sm font-medium text-gray-700 hover:border-brand hover:text-brand"
        >
          Request Swap
        </button>
      ) : job.swapBlockedReason ? (
        <p className="text-center text-xs text-gray-500">
          Swap unavailable — {job.swapBlockedReason.toLowerCase()}
        </p>
      ) : null}

      {swapError && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {swapError}
        </p>
      )}
    </div>
  );
}
