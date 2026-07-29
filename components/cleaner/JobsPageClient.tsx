"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader } from "lucide-react";
import { toast } from "sonner";
import { JobCard } from "@/components/cleaner/JobCard";
import { SwapRequestDialog } from "@/components/cleaner/SwapRequestDialog";
import { SwapOffersSection } from "@/components/cleaner/SwapOffersSection";
import { CleanerPageMessage } from "@/components/cleaner/CleanerPageMessage";
import { UrgentJobsSection } from "@/components/cleaner/UrgentJobsSection";
import type { CleanerJobSummary } from "@/lib/queries/cleaner-jobs";
import { parseCleanerApiError } from "@/lib/cleaner/parse-api-error";
import { isServiceUnavailableMessage } from "@/lib/env/messages";

export function JobsPageClient() {
  const [jobs, setJobs] = useState<CleanerJobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorVariant, setErrorVariant] = useState<"warning" | "error">(
    "warning"
  );
  const [swapDialogOpen, setSwapDialogOpen] = useState(false);
  const [preselectedSwapJobId, setPreselectedSwapJobId] = useState<string | null>(
    null
  );

  const loadJobs = useCallback(async () => {
    try {
      const response = await fetch("/api/cleaner/jobs");
      const data = (await response.json()) as {
        jobs?: CleanerJobSummary[];
        error?: string;
      };

      if (!response.ok) {
        const parsed = parseCleanerApiError(response, data);
        setError(parsed.message);
        setErrorVariant(parsed.variant === "error" ? "error" : "warning");
        if (isServiceUnavailableMessage(parsed.message)) {
          toast.error(parsed.message);
        }
        return;
      }

      setError(null);
      setJobs(data.jobs ?? []);
    } catch {
      setError("Could not load your jobs. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  function openSwapDialog(jobId: string | null) {
    setPreselectedSwapJobId(jobId);
    setSwapDialogOpen(true);
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader className="h-8 w-8 animate-spin text-brand" />
      </div>
    );
  }

  if (error) {
    return (
      <CleanerPageMessage
        title="Jobs unavailable"
        message={error}
        variant={errorVariant}
      />
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="space-y-4">
        <UrgentJobsSection />
        <SwapOffersSection onAccepted={loadJobs} />
        <CleanerPageMessage
          title="No upcoming jobs"
          message="You don't have any assigned cleans in the next two weeks. Update your availability or check back after new assignments."
          variant="empty"
        />
      </div>
    );
  }

  const swappableCount = jobs.filter((job) => job.canRequestSwap).length;

  return (
    <div className="space-y-4">
      <UrgentJobsSection />
      <SwapOffersSection onAccepted={loadJobs} />

      {swappableCount > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-gray-900">
              Can&apos;t make one of these?
            </p>
            <p className="text-xs text-gray-500">
              Choose which cleans to offer up — the first eligible cleaner to
              accept takes over.
            </p>
          </div>
          <button
            type="button"
            onClick={() => openSwapDialog(null)}
            className="shrink-0 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:border-brand hover:text-brand"
          >
            Request Swap
          </button>
        </div>
      )}

      {jobs.map((job) => (
        <JobCard
          key={job.jobId}
          job={job}
          onRequestSwap={openSwapDialog}
          onSwapWithdrawn={loadJobs}
        />
      ))}

      {swapDialogOpen && (
        <SwapRequestDialog
          jobs={jobs}
          preselectedJobId={preselectedSwapJobId}
          onClose={() => setSwapDialogOpen(false)}
          onSubmitted={loadJobs}
        />
      )}
    </div>
  );
}
