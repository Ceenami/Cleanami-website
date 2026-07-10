"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ClipboardCheck, Loader } from "lucide-react";
import { PayBreakdown } from "@/components/cleaner/PayBreakdown";
import type { CleanerJobDetail } from "@/lib/queries/cleaner-job-detail";
import { cn } from "@/lib/utils";

const roleLabels: Record<CleanerJobDetail["role"], { label: string; className: string }> = {
  teamLeader: { label: "Team Leader", className: "bg-indigo-100 text-indigo-800" },
  laundryLead: { label: "Laundry Lead", className: "bg-amber-100 text-amber-900" },
  primary: { label: "Primary", className: "bg-slate-100 text-slate-700" },
  backup: { label: "Backup", className: "bg-slate-100 text-slate-600" },
};

const statusLabels: Record<string, string> = {
  assigned: "Assigned",
  "in-progress": "In progress",
  completed_pending_evidence: "Pending evidence",
  awaiting_capture: "Awaiting capture",
  completed: "Completed",
  canceled: "Canceled",
};

export function JobDetailClient({ jobId }: { jobId: string }) {
  const searchParams = useSearchParams();
  const evidenceSubmitted = searchParams.get("evidenceSubmitted") === "1";

  const [job, setJob] = useState<CleanerJobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadJob = useCallback(async () => {
    const response = await fetch(`/api/cleaner/jobs/${jobId}`);
    if (!response.ok) throw new Error("Failed to load job");
    const data = (await response.json()) as { job: CleanerJobDetail };
    setJob(data.job);
  }, [jobId]);

  useEffect(() => {
    loadJob()
      .catch(() => setError("Could not load job details."))
      .finally(() => setLoading(false));
  }, [loadJob]);

  async function handleCheckIn() {
    setActionLoading(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/cleaner/jobs/${jobId}/check-in`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Check-in failed");
      setJob(data.job);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Check-in failed");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCheckOut() {
    setActionLoading(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/cleaner/jobs/${jobId}/check-out`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) {
        const missing = data.missing?.join(", ");
        throw new Error(
          missing ? `${data.error}: ${missing}` : (data.error ?? "Check-out failed")
        );
      }
      setJob(data.job);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Check-out failed");
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader className="h-8 w-8 animate-spin text-brand" />
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-red-700">
        {error ?? "Job not found"}
      </div>
    );
  }

  const role = roleLabels[job.role];
  const canCheckIn = job.status === "assigned";
  const canCheckOut =
    job.status === "in-progress" && job.evidence.hasSubmitted;
  const showEvidenceLink =
    job.status === "in-progress" || job.status === "completed_pending_evidence";

  return (
    <div className="space-y-4">
      <Link
        href="/cleaner/jobs"
        className="inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-brand"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to jobs
      </Link>

      {evidenceSubmitted && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Evidence submitted — your payout is being processed.
        </div>
      )}

      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold text-gray-900">
              {job.propertyAddress ?? "Address pending"}
            </h1>
            <span
              className={cn(
                "mt-1 inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold",
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

        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500">
          {statusLabels[job.status] ?? job.status}
        </p>

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
          {job.teammates.length > 0 && (
            <div>
              <dt className="font-medium text-gray-500">Teammates</dt>
              <dd className="mt-1 text-gray-900">
                {job.teammates.map((t) => t.name).join(", ")}
              </dd>
            </div>
          )}
        </dl>
      </div>

      <PayBreakdown payout={job.payBreakdown} />

      {job.checklistFiles.length > 0 && (
        <div className="rounded-xl border bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-gray-900">
            Property checklist
          </h3>
          <ul className="space-y-1">
            {job.checklistFiles.map((file) => (
              <li key={file.id}>
                <a
                  href={file.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-brand hover:underline"
                >
                  {file.fileName}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2">
        {canCheckIn && (
          <button
            type="button"
            onClick={handleCheckIn}
            disabled={actionLoading}
            className="w-full rounded-lg bg-brand py-3 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
          >
            {actionLoading ? "Checking in…" : "Check in"}
          </button>
        )}

        {showEvidenceLink && (
          <Link
            href={`/cleaner/jobs/${jobId}/evidence`}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-brand py-3 text-sm font-semibold text-brand hover:bg-brand/5"
          >
            <ClipboardCheck className="h-4 w-4" />
            {job.evidence.hasSubmitted
              ? "View / edit evidence"
              : "Submit evidence packet"}
          </Link>
        )}

        {canCheckOut && (
          <button
            type="button"
            onClick={handleCheckOut}
            disabled={actionLoading}
            className="w-full rounded-lg bg-gray-900 py-3 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {actionLoading ? "Checking out…" : "Check out"}
          </button>
        )}

        {job.status === "in-progress" && !job.evidence.hasSubmitted && (
          <p className="text-center text-xs text-gray-500">
            Submit your evidence packet before checking out.
          </p>
        )}
      </div>

      {actionError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </div>
      )}
    </div>
  );
}
