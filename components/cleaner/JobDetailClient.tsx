"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ClipboardCheck, Loader } from "lucide-react";
import { PayBreakdown } from "@/components/cleaner/PayBreakdown";
import { RestockRequestCard } from "@/components/cleaner/RestockRequestCard";
import type { CleanerJobDetail } from "@/lib/queries/cleaner-job-detail";
import {
  PETS_CLEANER_NOTE,
  type ServiceType,
} from "@/lib/constants/service-type";
import { cn } from "@/lib/utils";

const roleLabels: Record<CleanerJobDetail["role"], { label: string; className: string }> = {
  teamLeader: { label: "Team Leader", className: "bg-indigo-100 text-indigo-800" },
  laundryLead: { label: "Laundry Lead", className: "bg-amber-100 text-amber-900" },
  primary: { label: "Primary", className: "bg-slate-100 text-slate-700" },
  backup: { label: "Backup", className: "bg-slate-100 text-slate-600" },
};

const SERVICE_TYPE_BADGE: Record<ServiceType, string> = {
  vacation_rental_subscription: "bg-sky-100 text-sky-800",
  residential_one_time: "bg-violet-100 text-violet-800",
};

/** Short enough for a badge; the long form is the customer-facing label. */
const SERVICE_TYPE_SHORT: Record<ServiceType, string> = {
  vacation_rental_subscription: "Turnover",
  residential_one_time: "Residential",
};

/**
 * The two timestamps mean the same two things for both service types —
 * *arrive no earlier than this* and *be finished by this* — but they are named
 * for the vacation-rental case, and reading a residential job through
 * vacation-rental words is how the mapping gets implemented backwards.
 */
const TIME_LABELS: Record<ServiceType, { arrive: string; finish: string }> = {
  vacation_rental_subscription: {
    arrive: "Guest check-out",
    finish: "Must finish before",
  },
  residential_one_time: {
    arrive: "Arrival time",
    finish: "Estimated finish",
  },
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

  // Best-effort device location. Returns null if unavailable or denied — the
  // server records & flags but never blocks on a missing location.
  async function getDeviceLocation(): Promise<{
    latitude: number;
    longitude: number;
    accuracy: number | null;
  } | null> {
    if (typeof navigator === "undefined" || !navigator.geolocation) return null;
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? null,
          }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });
  }

  async function handleCheckIn() {
    setActionLoading(true);
    setActionError(null);
    try {
      const location = await getDeviceLocation();
      const response = await fetch(`/api/cleaner/jobs/${jobId}/check-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location }),
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
      const location = await getDeviceLocation();
      const response = await fetch(`/api/cleaner/jobs/${jobId}/check-out`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location }),
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
  const serviceType = (job.serviceType as ServiceType) in SERVICE_TYPE_BADGE
    ? (job.serviceType as ServiceType)
    : "vacation_rental_subscription";
  const labels = TIME_LABELS[serviceType];
  const hasAccessInfo = Boolean(
    job.entryMethodLabel || job.entryInstructions || job.parkingInstructions
  );
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
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span
                className={cn(
                  "inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold",
                  SERVICE_TYPE_BADGE[serviceType]
                )}
              >
                {SERVICE_TYPE_SHORT[serviceType]}
              </span>
              <span
                className={cn(
                  "inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold",
                  role.className
                )}
              >
                {role.label}
              </span>
            </div>
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
            <dt className="font-medium text-gray-500">{labels.arrive}</dt>
            <dd className="text-right text-gray-900">
              {/* The specific mistake this exists to prevent: the end of
                  a residential arrival window is NOT `check_out_time`. That is
                  the finish deadline — the window end plus the expected hours —
                  so the bounds come from the snapshot's window key instead.
                  `arrivalWindowLabel` is null for a turnover, which has a guest
                  check-out time rather than a window. */}
              {job.arrivalWindow ?? "TBD"}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="font-medium text-gray-500">{labels.finish}</dt>
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

        {/* Counterproposal item 7, the client's exact string, from the one
            shared constant the admin view also renders. */}
        {job.petsAllowed && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            🐾 {PETS_CLEANER_NOTE}
          </p>
        )}
      </div>

      {/*
        Item 13 — "door/lockbox/gate/garage code where applicable". This is the
        whole point of collecting access details: a cleaner who cannot get in
        cannot clean.

        Safe here, and ONLY here, because `getCleanerJobDetail` is
        assignment-scoped on both cleanerId and jobId — a cleaner who is not on
        this job never receives these fields at all. They are deliberately
        absent from the job LIST for the same reason.
      */}
      {hasAccessInfo && (
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold text-gray-900">
            Getting in
          </h3>
          <dl className="space-y-2 text-sm">
            {job.entryMethodLabel && (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Entry method
                </dt>
                <dd className="text-gray-900">{job.entryMethodLabel}</dd>
              </div>
            )}
            {job.entryInstructions && (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Access details
                </dt>
                {/* Codes are typed with meaningful line breaks ("Gate 4821,
                    then lockbox 0917"); `whitespace-pre-wrap` keeps them and
                    `break-words` stops a long code widening the card. */}
                <dd className="whitespace-pre-wrap break-words font-medium text-gray-900">
                  {job.entryInstructions}
                </dd>
                <p className="mt-1 text-xs text-amber-700">
                  Confidential — for this clean only. Do not share or write it
                  down anywhere else.
                </p>
              </div>
            )}
            {job.parkingInstructions && (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Parking
                </dt>
                <dd className="whitespace-pre-wrap break-words text-gray-900">
                  {job.parkingInstructions}
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {/*
        Rendered as its own card, not inside "Getting in". Item 13 lists the
        customer's notes separately from the access instructions, and it is
        right to: a note about the dog is not a note about the gate code, and
        burying one in the other is how a cleaner misses whichever they were not
        looking for.
      */}
      {job.customerNotes && (
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold text-gray-900">
            Notes from the customer
          </h3>
          <p className="whitespace-pre-wrap break-words text-sm text-gray-700">
            {job.customerNotes}
          </p>
        </div>
      )}

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

      <RestockRequestCard jobId={jobId} />

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
