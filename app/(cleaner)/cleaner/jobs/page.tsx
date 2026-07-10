import { JobsPageClient } from "@/components/cleaner/JobsPageClient";

export default function CleanerJobsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Your Jobs</h2>
        <p className="text-sm text-gray-500">Upcoming assignments</p>
      </div>
      <JobsPageClient />
    </div>
  );
}
