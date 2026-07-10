"use client";

import { useEffect, useState } from "react";
import { Loader } from "lucide-react";
import { toast } from "sonner";
import { JobCard } from "@/components/cleaner/JobCard";
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

  useEffect(() => {
    async function loadJobs() {
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

        setJobs(data.jobs ?? []);
      } catch {
        setError("Could not load your jobs. Please try again.");
      } finally {
        setLoading(false);
      }
    }

    loadJobs();
  }, []);

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
        <CleanerPageMessage
          title="No upcoming jobs"
          message="You don't have any assigned cleans in the next two weeks. Update your availability or check back after new assignments."
          variant="empty"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <UrgentJobsSection />
      {jobs.map((job) => (
        <JobCard key={job.jobId} job={job} />
      ))}
    </div>
  );
}
